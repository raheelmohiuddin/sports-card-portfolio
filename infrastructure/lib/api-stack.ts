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
import * as ses from "aws-cdk-lib/aws-ses";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import * as path from "path";

// Single source of truth for the admin email — used as both the SES sender
// (must be verified) and the destination for new-consignment notifications.
const ADMIN_EMAIL = "raheelmohiuddin1@gmail.com";

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

    const portfolioHistoryFn = new NodejsFunction(this, "PortfolioHistory", {
      ...sharedNodejsProps,
      functionName: "scp-portfolio-history",
      entry: path.join(functionsDir, "portfolio/get-history.js"),
    });

    const cardSalesFn = new NodejsFunction(this, "CardSales", {
      ...sharedNodejsProps,
      functionName: "scp-card-sales",
      entry: path.join(functionsDir, "portfolio/get-card-sales.js"),
    });

    const avatarUploadUrlFn = new NodejsFunction(this, "AvatarUploadUrl", {
      ...sharedNodejsProps,
      functionName: "scp-avatar-upload-url",
      entry: path.join(functionsDir, "profile/get-avatar-upload-url.js"),
    });

    const avatarViewUrlFn = new NodejsFunction(this, "AvatarViewUrl", {
      ...sharedNodejsProps,
      functionName: "scp-avatar-view-url",
      entry: path.join(functionsDir, "profile/get-avatar-view-url.js"),
    });

    const updatePriceFn = new NodejsFunction(this, "UpdatePrice", {
      ...sharedNodejsProps,
      functionName: "scp-update-price",
      entry: path.join(functionsDir, "cards/update-price.js"),
    });

    const updateCardFn = new NodejsFunction(this, "UpdateCard", {
      ...sharedNodejsProps,
      functionName: "scp-update-card",
      entry: path.join(functionsDir, "cards/update-card.js"),
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

    // Image moderation gate — runs before the S3 pre-signed URL is
    // requested in AddCardPage so rejected images never reach storage.
    // Same Anthropic key as edge-texture; VPC NAT egress reaches
    // api.anthropic.com.
    const moderateImageFn = new NodejsFunction(this, "ModerateImage", {
      ...sharedNodejsProps,
      functionName: "scp-moderate-image",
      entry: path.join(functionsDir, "cards/moderate-image.js"),
      timeout: cdk.Duration.seconds(20),
    });
    moderateImageFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: ["arn:aws:secretsmanager:us-east-1:501789774892:secret:sports-card-portfolio/anthropic-api-key*"],
      })
    );

    // One-off migration Lambda — invoke manually after deploy. Idempotent.
    const migrationAddMyCostFn = new NodejsFunction(this, "MigrationAddMyCost", {
      ...sharedNodejsProps,
      functionName: "scp-migration-add-my-cost",
      entry: path.join(functionsDir, "_migrations/add-my-cost.js"),
    });
    props.dbSecret.grantRead(migrationAddMyCostFn);

    // Migration: target_price column + portfolio_snapshots table.
    const migrationPortfolioFeaturesFn = new NodejsFunction(this, "MigrationAddPortfolioFeatures", {
      ...sharedNodejsProps,
      functionName: "scp-migration-add-portfolio-features",
      entry: path.join(functionsDir, "_migrations/add-portfolio-features.js"),
    });
    props.dbSecret.grantRead(migrationPortfolioFeaturesFn);

    // Migration: roles + consignments table.
    const migrationRolesFn = new NodejsFunction(this, "MigrationAddRolesAndConsignments", {
      ...sharedNodejsProps,
      functionName: "scp-migration-add-roles-and-consignments",
      entry: path.join(functionsDir, "_migrations/add-roles-and-consignments.js"),
    });
    props.dbSecret.grantRead(migrationRolesFn);

    // One-off DESTRUCTIVE truncate. Removes every row from every user-data
    // table. Invoke manually after deploy; remove from CDK after use.
    const migrationTruncateFn = new NodejsFunction(this, "MigrationTruncateAll", {
      ...sharedNodejsProps,
      functionName: "scp-migration-truncate-all",
      entry: path.join(functionsDir, "_migrations/truncate-all.js"),
    });
    props.dbSecret.grantRead(migrationTruncateFn);

    // Migration: sold_price column on consignments.
    const migrationSoldPriceFn = new NodejsFunction(this, "MigrationAddSoldPrice", {
      ...sharedNodejsProps,
      functionName: "scp-migration-add-sold-price",
      entry: path.join(functionsDir, "_migrations/add-sold-price.js"),
    });
    props.dbSecret.grantRead(migrationSoldPriceFn);

    // Migration: card_shows + user_shows tables.
    const migrationShowsTablesFn = new NodejsFunction(this, "MigrationAddShowsTables", {
      ...sharedNodejsProps,
      functionName: "scp-migration-add-shows-tables",
      entry: path.join(functionsDir, "_migrations/add-shows-tables.js"),
    });
    props.dbSecret.grantRead(migrationShowsTablesFn);

    // Migration: end_date column + consolidate consecutive duplicate shows.
    const migrationMergeShowsFn = new NodejsFunction(this, "MigrationAddEndDateAndMergeShows", {
      ...sharedNodejsProps,
      functionName: "scp-migration-add-end-date-and-merge-shows",
      entry: path.join(functionsDir, "_migrations/add-end-date-and-merge-shows.js"),
      // Dedup pass on a few thousand rows finishes well under default
      // timeout, but bumping for headroom.
      timeout: cdk.Duration.seconds(120),
    });
    props.dbSecret.grantRead(migrationMergeShowsFn);

    // Migration: daily_times JSONB column for per-day multi-day schedules.
    const migrationDailyTimesFn = new NodejsFunction(this, "MigrationAddDailyTimes", {
      ...sharedNodejsProps,
      functionName: "scp-migration-add-daily-times",
      entry: path.join(functionsDir, "_migrations/add-daily-times.js"),
    });
    props.dbSecret.grantRead(migrationDailyTimesFn);

    // Migration: lat/lng columns + index for proximity filtering.
    const migrationShowCoordsFn = new NodejsFunction(this, "MigrationAddShowCoords", {
      ...sharedNodejsProps,
      functionName: "scp-migration-add-show-coords",
      entry: path.join(functionsDir, "_migrations/add-show-coords.js"),
    });
    props.dbSecret.grantRead(migrationShowCoordsFn);

    // Migration: auction_platform column on consignments.
    const migrationAuctionPlatformFn = new NodejsFunction(this, "MigrationAddAuctionPlatform", {
      ...sharedNodejsProps,
      functionName: "scp-migration-add-auction-platform",
      entry: path.join(functionsDir, "_migrations/add-auction-platform.js"),
    });
    props.dbSecret.grantRead(migrationAuctionPlatformFn);

    // Migration: ever_declined column + consignment_blocks survival table.
    const migrationConsignmentBlocksFn = new NodejsFunction(this, "MigrationAddConsignmentBlocks", {
      ...sharedNodejsProps,
      functionName: "scp-migration-add-consignment-blocks",
      entry: path.join(functionsDir, "_migrations/add-consignment-blocks.js"),
    });
    props.dbSecret.grantRead(migrationConsignmentBlocksFn);

    // Diagnostic: exercises the decline → block flow inside a
    // transaction with a ROLLBACK at the end. No production data
    // mutated. Direct-invoke only.
    const testDeclineLogicFn = new NodejsFunction(this, "TestDeclineLogic", {
      ...sharedNodejsProps,
      functionName: "scp-test-decline-logic",
      entry: path.join(functionsDir, "_diagnostics/test-decline-logic.js"),
    });
    props.dbSecret.grantRead(testDeclineLogicFn);

    // Helper Lambda for the local geocoding pipeline — accepts a payload
    // of city/state → coords mappings and applies them as UPDATEs.
    // Direct-invoke only (no API route).
    const applyShowCoordsFn = new NodejsFunction(this, "ApplyShowCoords", {
      ...sharedNodejsProps,
      functionName: "scp-apply-show-coords",
      entry: path.join(functionsDir, "shows/apply-show-coords.js"),
      timeout: cdk.Duration.seconds(60),
    });
    props.dbSecret.grantRead(applyShowCoordsFn);

    // ─── Card-shows feature ───
    const importShowsFn = new NodejsFunction(this, "ImportShows", {
      ...sharedNodejsProps,
      functionName: "scp-import-shows",
      entry: path.join(functionsDir, "shows/import-shows.js"),
      // Bulk insert can take a moment if the payload is large.
      timeout: cdk.Duration.seconds(60),
    });
    const listShowsFn = new NodejsFunction(this, "ListShows", {
      ...sharedNodejsProps,
      functionName: "scp-list-shows",
      entry: path.join(functionsDir, "shows/list-shows.js"),
    });
    const markAttendingFn = new NodejsFunction(this, "MarkAttending", {
      ...sharedNodejsProps,
      functionName: "scp-mark-attending",
      entry: path.join(functionsDir, "shows/mark-attending.js"),
    });
    const unmarkAttendingFn = new NodejsFunction(this, "UnmarkAttending", {
      ...sharedNodejsProps,
      functionName: "scp-unmark-attending",
      entry: path.join(functionsDir, "shows/unmark-attending.js"),
    });

    // ─── Consignment + admin functions ───
    const createConsignmentFn = new NodejsFunction(this, "CreateConsignment", {
      ...sharedNodejsProps,
      functionName: "scp-create-consignment",
      entry: path.join(functionsDir, "consignments/create.js"),
      environment: { ...sharedEnv, ADMIN_EMAIL, SENDER_EMAIL: ADMIN_EMAIL },
    });

    // Admin Lambdas need the user pool ID at runtime so requireAdmin can do
    // a live AdminGetUser fallback when the JWT claim is stale (e.g. user was
    // promoted via Cognito console but their existing JWT is still pre-promotion).
    const adminFnEnv = { ...sharedEnv, USER_POOL_ID: props.userPool.userPoolId };

    const adminStatsFn = new NodejsFunction(this, "AdminStats", {
      ...sharedNodejsProps,
      functionName: "scp-admin-stats",
      entry: path.join(functionsDir, "admin/stats.js"),
      environment: adminFnEnv,
    });

    const adminCardsFn = new NodejsFunction(this, "AdminCards", {
      ...sharedNodejsProps,
      functionName: "scp-admin-cards",
      entry: path.join(functionsDir, "admin/all-cards.js"),
      environment: adminFnEnv,
    });

    const adminConsignmentsListFn = new NodejsFunction(this, "AdminConsignmentsList", {
      ...sharedNodejsProps,
      functionName: "scp-admin-consignments-list",
      entry: path.join(functionsDir, "admin/list-consignments.js"),
      environment: adminFnEnv,
    });

    const adminConsignmentUpdateFn = new NodejsFunction(this, "AdminConsignmentUpdate", {
      ...sharedNodejsProps,
      functionName: "scp-admin-consignment-update",
      entry: path.join(functionsDir, "admin/update-consignment.js"),
      environment: adminFnEnv,
    });

    // Admin-scoped single-card lookups — used when an admin clicks a row in
    // the consignments queue and we open CardModal for a card they don't own.
    const adminCardFn = new NodejsFunction(this, "AdminCard", {
      ...sharedNodejsProps,
      functionName: "scp-admin-card",
      entry: path.join(functionsDir, "admin/get-card.js"),
      environment: adminFnEnv,
    });
    const adminCardSalesFn = new NodejsFunction(this, "AdminCardSales", {
      ...sharedNodejsProps,
      functionName: "scp-admin-card-sales",
      entry: path.join(functionsDir, "admin/get-card-sales.js"),
      environment: adminFnEnv,
    });

    // Grant cognito-idp:AdminGetUser to the admin Lambdas for the live
    // fallback in requireAdmin. Wildcard ARN (no CFN ref) to avoid the same
    // circular dependency we hit in auth-stack.ts.
    const cognitoArnWildcard = `arn:aws:cognito-idp:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:userpool/*`;
    for (const fn of [adminStatsFn, adminCardsFn, adminConsignmentsListFn, adminConsignmentUpdateFn, adminCardFn, adminCardSalesFn]) {
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ["cognito-idp:AdminGetUser"],
        resources: [cognitoArnWildcard],
      }));
    }

    // SES verified identity for the admin email — required for sending in
    // SES sandbox mode. Verification URL is emailed to ADMIN_EMAIL on first
    // deploy; click it once to enable sending. Both From and To are the same
    // address, which is allowed in the sandbox without production access.
    new ses.EmailIdentity(this, "AdminEmailIdentity", {
      identity: ses.Identity.email(ADMIN_EMAIL),
    });

    // Grant SES send permission to the consignment-create Lambda.
    createConsignmentFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        // Identity ARNs are scoped to the verified address.
        resources: [
          `arn:aws:ses:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:identity/${ADMIN_EMAIL}`,
        ],
      })
    );

    // Grant permissions
    const consignmentAndAdminFns = [
      createConsignmentFn,
      adminStatsFn,
      adminCardsFn,
      adminConsignmentsListFn,
      adminConsignmentUpdateFn,
      adminCardFn,
      adminCardSalesFn,
      importShowsFn,
      listShowsFn,
      markAttendingFn,
      unmarkAttendingFn,
    ];
    for (const fn of [addCardFn, getCardsFn, getCardFn, deleteCardFn, psaLookupFn, portfolioValueFn, portfolioHistoryFn, cardSalesFn, updatePriceFn, updateCardFn, avatarUploadUrlFn, avatarViewUrlFn, ...consignmentAndAdminFns]) {
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
      path: "/portfolio/history",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2integrations.HttpLambdaIntegration("PortfolioHistory", portfolioHistoryFn),
      ...authRoute,
    });

    api.addRoutes({
      path: "/cards/{id}/sales",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2integrations.HttpLambdaIntegration("CardSales", cardSalesFn),
      ...authRoute,
    });

    api.addRoutes({
      path: "/profile/avatar-upload-url",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2integrations.HttpLambdaIntegration("AvatarUploadUrl", avatarUploadUrlFn),
      ...authRoute,
    });

    api.addRoutes({
      path: "/profile/avatar-view-url",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2integrations.HttpLambdaIntegration("AvatarViewUrl", avatarViewUrlFn),
      ...authRoute,
    });

    api.addRoutes({
      path: "/cards/{id}/price",
      methods: [apigwv2.HttpMethod.PATCH],
      integration: new apigwv2integrations.HttpLambdaIntegration("UpdatePrice", updatePriceFn),
      ...authRoute,
    });

    api.addRoutes({
      path: "/cards/{id}",
      methods: [apigwv2.HttpMethod.PUT],
      integration: new apigwv2integrations.HttpLambdaIntegration("UpdateCard", updateCardFn),
      ...authRoute,
    });

    api.addRoutes({
      path: "/cards/edge-texture",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2integrations.HttpLambdaIntegration("GenerateEdgeTexture", generateEdgeTextureFn),
      ...authRoute,
    });

    api.addRoutes({
      path: "/cards/moderate-image",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2integrations.HttpLambdaIntegration("ModerateImage", moderateImageFn),
      ...authRoute,
    });

    // ─── Consignment + admin routes ───
    api.addRoutes({
      path: "/consignments",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2integrations.HttpLambdaIntegration("CreateConsignment", createConsignmentFn),
      ...authRoute,
    });

    api.addRoutes({
      path: "/admin/stats",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2integrations.HttpLambdaIntegration("AdminStats", adminStatsFn),
      ...authRoute,
    });

    api.addRoutes({
      path: "/admin/cards",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2integrations.HttpLambdaIntegration("AdminCards", adminCardsFn),
      ...authRoute,
    });

    api.addRoutes({
      path: "/admin/consignments",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2integrations.HttpLambdaIntegration("AdminConsignmentsList", adminConsignmentsListFn),
      ...authRoute,
    });

    api.addRoutes({
      path: "/admin/consignments/{id}",
      methods: [apigwv2.HttpMethod.PATCH],
      integration: new apigwv2integrations.HttpLambdaIntegration("AdminConsignmentUpdate", adminConsignmentUpdateFn),
      ...authRoute,
    });

    api.addRoutes({
      path: "/admin/cards/{id}",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2integrations.HttpLambdaIntegration("AdminCard", adminCardFn),
      ...authRoute,
    });

    api.addRoutes({
      path: "/admin/cards/{id}/sales",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2integrations.HttpLambdaIntegration("AdminCardSales", adminCardSalesFn),
      ...authRoute,
    });

    api.addRoutes({
      path: "/shows",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2integrations.HttpLambdaIntegration("ListShows", listShowsFn),
      ...authRoute,
    });
    api.addRoutes({
      path: "/shows/{id}/attending",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2integrations.HttpLambdaIntegration("MarkAttending", markAttendingFn),
      ...authRoute,
    });
    api.addRoutes({
      path: "/shows/{id}/attending",
      methods: [apigwv2.HttpMethod.DELETE],
      integration: new apigwv2integrations.HttpLambdaIntegration("UnmarkAttending", unmarkAttendingFn),
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
