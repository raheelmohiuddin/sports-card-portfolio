import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as apigwv2authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import * as path from "path";

interface ApiStackProps {
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  cluster: rds.DatabaseCluster;
  dbSecret: secretsmanager.ISecret;
  cardImagesBucket: s3.Bucket;
  vpc: ec2.Vpc;
  dbSecurityGroup: ec2.SecurityGroup;
}

export class ApiStack extends Construct {
  public readonly apiUrl: string;
  public readonly apiHostname: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id);

    const lambdaSg = new ec2.SecurityGroup(this, "LambdaSg", {
      vpc: props.vpc,
      description: "Lambda functions security group",
    });

    // Allow Lambda to reach Aurora
    props.dbSecurityGroup.addIngressRule(
      lambdaSg,
      ec2.Port.tcp(5432),
      "Lambda access to Aurora"
    );

    // Shared environment for all Lambda functions
    const sharedEnv = {
      DB_SECRET_ARN: props.dbSecret.secretArn,
      DB_NAME: "cardportfolio",
      CARD_IMAGES_BUCKET: props.cardImagesBucket.bucketName,
      PSA_API_BASE: "https://api.psacard.com/publicapi",
    };

    const functionsDir = path.join(__dirname, "../../backend/functions");

    // NodejsFunction uses esbuild to bundle each handler + its imports into a
    // single file — no node_modules directory needed in the deployment zip.
    const sharedNodejsProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSg],
      environment: sharedEnv,
      bundling: {
        minify: false,
        sourceMap: false,
        // esbuild targets Node 20
        target: "node20",
      },
    };

    const addCardFn = new NodejsFunction(this, "AddCard", {
      ...sharedNodejsProps,
      functionName: "scp-add-card",
      entry: path.join(functionsDir, "cards/add-card.js"),
    });

    const getCardsFn = new NodejsFunction(this, "GetCards", {
      ...sharedNodejsProps,
      functionName: "scp-get-cards",
      entry: path.join(functionsDir, "cards/get-cards.js"),
    });

    const deleteCardFn = new NodejsFunction(this, "DeleteCard", {
      ...sharedNodejsProps,
      functionName: "scp-delete-card",
      entry: path.join(functionsDir, "cards/delete-card.js"),
    });

    const getCardFn = new NodejsFunction(this, "GetCard", {
      ...sharedNodejsProps,
      functionName: "scp-get-card",
      entry: path.join(functionsDir, "cards/get-card.js"),
    });

    const psaLookupFn = new NodejsFunction(this, "PsaLookup", {
      ...sharedNodejsProps,
      functionName: "scp-psa-lookup",
      entry: path.join(functionsDir, "cards/psa-lookup.js"),
    });

    const portfolioValueFn = new NodejsFunction(this, "PortfolioValue", {
      ...sharedNodejsProps,
      functionName: "scp-portfolio-value",
      entry: path.join(functionsDir, "portfolio/get-value.js"),
    });

    const updatePriceFn = new NodejsFunction(this, "UpdatePrice", {
      ...sharedNodejsProps,
      functionName: "scp-update-price",
      entry: path.join(functionsDir, "cards/update-price.js"),
    });

    // Edge texture uses Anthropic vision — no DB or S3 access needed.
    // VPC gives it NAT gateway egress to reach api.anthropic.com.
    const generateEdgeTextureFn = new NodejsFunction(this, "GenerateEdgeTexture", {
      ...sharedNodejsProps,
      functionName: "scp-generate-edge-texture",
      entry: path.join(functionsDir, "cards/generate-edge-texture.js"),
      timeout: cdk.Duration.seconds(30),
    });

    generateEdgeTextureFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: ["arn:aws:secretsmanager:us-east-1:501789774892:secret:sports-card-portfolio/anthropic-api-key*"],
      })
    );

    // Grant permissions
    for (const fn of [addCardFn, getCardsFn, getCardFn, deleteCardFn, psaLookupFn, portfolioValueFn, updatePriceFn]) {
      props.dbSecret.grantRead(fn);
      props.cardImagesBucket.grantReadWrite(fn);
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["s3:GetObject", "s3:PutObject"],
          resources: [props.cardImagesBucket.arnForObjects("*")],
        })
      );
    }

    // Re-attach the PSA key permission to the new psa-lookup role
    psaLookupFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: ["arn:aws:secretsmanager:us-east-1:501789774892:secret:sports-card-portfolio/psa-api-key-s4T0T9"],
      })
    );

    // HTTP API Gateway with Cognito JWT authorizer
    const authorizer = new apigwv2authorizers.HttpUserPoolAuthorizer(
      "CognitoAuthorizer",
      props.userPool,
      {
        userPoolClients: [props.userPoolClient],
        identitySource: ["$request.header.Authorization"],
      }
    );

    const api = new apigwv2.HttpApi(this, "Api", {
      apiName: "sports-card-portfolio-api",
      corsPreflight: {
        allowOrigins: ["*"], // Restrict to your Amplify domain in production
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowHeaders: ["Authorization", "Content-Type"],
      },
    });

    const authRoute = { authorizer };

    api.addRoutes({
      path: "/cards",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2integrations.HttpLambdaIntegration("GetCards", getCardsFn),
      ...authRoute,
    });

    api.addRoutes({
      path: "/cards",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2integrations.HttpLambdaIntegration("AddCard", addCardFn),
      ...authRoute,
    });

    api.addRoutes({
      path: "/cards/{id}",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2integrations.HttpLambdaIntegration("GetCard", getCardFn),
      ...authRoute,
    });

    api.addRoutes({
      path: "/cards/{id}",
      methods: [apigwv2.HttpMethod.DELETE],
      integration: new apigwv2integrations.HttpLambdaIntegration("DeleteCard", deleteCardFn),
      ...authRoute,
    });

    api.addRoutes({
      path: "/psa/{certNumber}",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2integrations.HttpLambdaIntegration("PsaLookup", psaLookupFn),
      ...authRoute,
    });

    api.addRoutes({
      path: "/portfolio/value",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2integrations.HttpLambdaIntegration("PortfolioValue", portfolioValueFn),
      ...authRoute,
    });

    api.addRoutes({
      path: "/cards/{id}/price",
      methods: [apigwv2.HttpMethod.PATCH],
      integration: new apigwv2integrations.HttpLambdaIntegration("UpdatePrice", updatePriceFn),
      ...authRoute,
    });

    api.addRoutes({
      path: "/cards/edge-texture",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2integrations.HttpLambdaIntegration("GenerateEdgeTexture", generateEdgeTextureFn),
      ...authRoute,
    });

    // Stage-level throttling — caps total req/s across all callers as a
    // secondary defence; per-IP limiting lives in the WAF rate-based rule.
    const cfnStage = api.defaultStage!.node.defaultChild as apigwv2.CfnStage;
    cfnStage.addPropertyOverride("DefaultRouteSettings", {
      ThrottlingBurstLimit: 500,
      ThrottlingRateLimit: 50,
    });

    this.apiUrl = api.apiEndpoint;
    // Strip the protocol so this can be passed to CloudFront as an origin hostname.
    this.apiHostname = cdk.Fn.select(2, cdk.Fn.split("/", api.apiEndpoint));
    new cdk.CfnOutput(this, "ApiEndpoint", { value: this.apiUrl });
  }
}
