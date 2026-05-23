import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubs from "aws-cdk-lib/aws-sns-subscriptions";
import * as rds from "aws-cdk-lib/aws-rds";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { Construct } from "constructs";

interface MonitoringStackProps {
  cluster: rds.IDatabaseCluster;
  httpApi: apigwv2.HttpApi;
  alertEmail: string;
}

// Single notification path (SNS topic + email subscription) for nine alarms
// across Lambda, RDS Aurora Serverless v2, and API Gateway HttpApi v2. Alarm
// inventory and thresholds locked in p0-hardening-session-a-plan.md OQ-2.
// Aggregate (no FunctionName dimension) Lambda alarms per OQ-1.
export class MonitoringStack extends Construct {
  public readonly alertTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id);

    this.alertTopic = new sns.Topic(this, "AlertTopic", {
      displayName: "Collector's Reserve alerts",
    });
    this.alertTopic.addSubscription(
      new snsSubs.EmailSubscription(props.alertEmail)
    );
    const alarmAction = new cwActions.SnsAction(this.alertTopic);

    const clusterDimensions = {
      DBClusterIdentifier: props.cluster.clusterIdentifier,
    };
    const httpApiDimensions = { ApiId: props.httpApi.apiId };

    // ─── Lambda layer (account/region-wide, no FunctionName dimension) ───
    const lambdaErrorsAggregate = new cloudwatch.Alarm(this, "LambdaErrorsAggregate", {
      alarmName: "Lambda-Errors-Aggregate",
      metric: new cloudwatch.Metric({
        namespace: "AWS/Lambda",
        metricName: "Errors",
        statistic: "Sum",
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "Sev-1: Lambda errors across all functions exceeded threshold.",
    });

    const lambdaThrottlesAggregate = new cloudwatch.Alarm(this, "LambdaThrottlesAggregate", {
      alarmName: "Lambda-Throttles-Aggregate",
      metric: new cloudwatch.Metric({
        namespace: "AWS/Lambda",
        metricName: "Throttles",
        statistic: "Sum",
        period: cdk.Duration.minutes(5),
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "Sev-1: Lambda throttles across all functions detected.",
    });

    // ─── RDS Aurora Serverless v2 layer ──────────────────────────────────
    const rdsCpuHigh = new cloudwatch.Alarm(this, "RdsCpuHigh", {
      alarmName: "RDS-CPU-High",
      metric: new cloudwatch.Metric({
        namespace: "AWS/RDS",
        metricName: "CPUUtilization",
        statistic: "Average",
        period: cdk.Duration.minutes(5),
        dimensionsMap: clusterDimensions,
      }),
      threshold: 80,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "Sev-2: RDS cluster CPU averaged above 80% for two periods.",
    });

    const rdsConnectionsHigh = new cloudwatch.Alarm(this, "RdsConnectionsHigh", {
      alarmName: "RDS-Connections-High",
      metric: new cloudwatch.Metric({
        namespace: "AWS/RDS",
        metricName: "DatabaseConnections",
        statistic: "Average",
        period: cdk.Duration.minutes(5),
        dimensionsMap: clusterDimensions,
      }),
      threshold: 80,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "Sev-2: RDS cluster connection count above 80.",
    });

    // FreeableMemory on Aurora Serverless v2 stays inflated by ~2 GiB per
    // spare ACU below max; this terminal-state alarm fires only when the
    // cluster has scaled to max ACU AND physical memory is near-exhausted.
    // Not redundant with RDS-ACU-NearMax — they fire in sequence, not parallel.
    const rdsFreeableMemoryLow = new cloudwatch.Alarm(this, "RdsFreeableMemoryLow", {
      alarmName: "RDS-FreeableMemory-Low",
      metric: new cloudwatch.Metric({
        namespace: "AWS/RDS",
        metricName: "FreeableMemory",
        statistic: "Average",
        period: cdk.Duration.minutes(5),
        dimensionsMap: clusterDimensions,
      }),
      threshold: 100 * 1024 * 1024,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "Sev-1: RDS cluster freeable memory below 100 MiB.",
    });

    const rdsAcuNearMax = new cloudwatch.Alarm(this, "RdsAcuNearMax", {
      alarmName: "RDS-ACU-NearMax",
      metric: new cloudwatch.Metric({
        namespace: "AWS/RDS",
        metricName: "ACUUtilization",
        statistic: "Average",
        period: cdk.Duration.minutes(5),
        dimensionsMap: clusterDimensions,
      }),
      threshold: 87.5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "Sev-2: Aurora Serverless v2 ACU > 87.5% of max - trigger to bump serverlessV2MaxCapacity.",
    });

    // ─── API Gateway HttpApi v2 layer ────────────────────────────────────
    // v2 metric names: `5xx`, `4xx`, `Latency` (NOT v1's `5XXError`/`Latency` —
    // using v1 names against an HttpApi silently returns no data).
    const httpApi5xxHigh = new cloudwatch.Alarm(this, "HttpApi5xxHigh", {
      alarmName: "HttpApi-5xx-High",
      metric: new cloudwatch.Metric({
        namespace: "AWS/ApiGateway",
        metricName: "5xx",
        statistic: "Sum",
        period: cdk.Duration.minutes(5),
        dimensionsMap: httpApiDimensions,
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "Sev-1: HttpApi 5xx responses exceeded threshold.",
    });

    const httpApi4xxHigh = new cloudwatch.Alarm(this, "HttpApi4xxHigh", {
      alarmName: "HttpApi-4xx-High",
      metric: new cloudwatch.Metric({
        namespace: "AWS/ApiGateway",
        metricName: "4xx",
        statistic: "Sum",
        period: cdk.Duration.minutes(5),
        dimensionsMap: httpApiDimensions,
      }),
      threshold: 50,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "Sev-3: HttpApi 4xx responses elevated - investigate client behavior or routing.",
    });

    const httpApiLatencyHigh = new cloudwatch.Alarm(this, "HttpApiLatencyHigh", {
      alarmName: "HttpApi-Latency-High",
      metric: new cloudwatch.Metric({
        namespace: "AWS/ApiGateway",
        metricName: "Latency",
        statistic: "p99",
        period: cdk.Duration.minutes(10),
        dimensionsMap: httpApiDimensions,
      }),
      threshold: 3000,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "Sev-2: HttpApi p99 latency above 3000ms.",
    });

    for (const alarm of [
      lambdaErrorsAggregate,
      lambdaThrottlesAggregate,
      rdsCpuHigh,
      rdsConnectionsHigh,
      rdsFreeableMemoryLow,
      rdsAcuNearMax,
      httpApi5xxHigh,
      httpApi4xxHigh,
      httpApiLatencyHigh,
    ]) {
      alarm.addAlarmAction(alarmAction);
    }

    new cdk.CfnOutput(this, "AlertTopicArn", { value: this.alertTopic.topicArn });
  }
}
