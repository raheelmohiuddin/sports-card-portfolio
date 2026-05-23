import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export class DatabaseStack extends Construct {
  public readonly cluster: rds.IDatabaseCluster;
  public readonly secret: secretsmanager.ISecret;
  public readonly vpc: ec2.Vpc;
  public readonly dbSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // VPC for RDS — Lambda functions will run in this VPC too
    this.vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "private", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: "isolated", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    this.dbSecurityGroup = new ec2.SecurityGroup(this, "DbSecurityGroup", {
      vpc: this.vpc,
      description: "Allow Lambda access to Aurora",
    });

    // L1 CfnDBCluster (not L2 rds.DatabaseCluster) because the deployed stack
    // was populated via `cdk import` and does not include the Secret,
    // SecretTargetAttachment, DBSubnetGroup, or DBInstance resources that
    // L2 would auto-emit. Properties match the deployed template exactly.
    const cfnCluster = new rds.CfnDBCluster(this, "Cluster", {
      engine: "aurora-postgresql",
      engineVersion: "16.11",
      dbClusterIdentifier: "sportscardportfolio-encrypted-20260520202459",
      dbClusterParameterGroupName: "default.aurora-postgresql16",
      dbSubnetGroupName:
        "sportscardportfolio-databaseclustersubnets5540150d-1l9befqursoc",
      databaseName: "cardportfolio",
      deletionProtection: true,
      enableHttpEndpoint: true,
      kmsKeyId:
        "arn:aws:kms:us-east-1:501789774892:key/84ff3a75-a308-48cf-9dcd-581099b81d5b",
      masterUserPassword: "import-placeholder",
      masterUsername: "dbadmin",
      port: 5432,
      preferredBackupWindow: "07:00-07:30",
      preferredMaintenanceWindow: "sat:06:18-sat:06:48",
      serverlessV2ScalingConfiguration: {
        maxCapacity: 4,
        minCapacity: 0.5,
      },
      storageEncrypted: true,
      backupRetentionPeriod: 7,
      copyTagsToSnapshot: true,
      vpcSecurityGroupIds: [this.dbSecurityGroup.securityGroupId],
    });

    cfnCluster.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    cfnCluster.overrideLogicalId("DatabaseCluster5B53A178");

    this.secret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      "ImportedDbSecret",
      "arn:aws:secretsmanager:us-east-1:501789774892:secret:SportsCardPortfolioDatabase-etmMTTGC8xX3-G6o7EM"
    );

    this.cluster = rds.DatabaseCluster.fromDatabaseClusterAttributes(
      this,
      "ImportedCluster",
      {
        clusterIdentifier: cfnCluster.ref,
        secret: this.secret,
      }
    );

    new cdk.CfnOutput(this, "DbSecretArn", { value: this.secret.secretArn });
  }
}
