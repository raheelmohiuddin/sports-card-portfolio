import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { AuthStack } from "./auth-stack";
import { StorageStack } from "./storage-stack";
import { DatabaseStack } from "./database-stack";
import { ApiStack } from "./api-stack";
import { SecurityStack } from "./security-stack";

export class MainStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const auth = new AuthStack(this, "Auth");
    const storage = new StorageStack(this, "Storage");
    const database = new DatabaseStack(this, "Database");

    const api = new ApiStack(this, "Api", {
      userPool: auth.userPool,
      userPoolClient: auth.userPoolClient,
      cluster: database.cluster,
      dbSecret: database.secret,
      cardImagesBucket: storage.cardImagesBucket,
      vpc: database.vpc,
      dbSecurityGroup: database.dbSecurityGroup,
    });

    // WAF + CloudFront in front of API Gateway. Shield Standard is automatic
    // on every AWS account and is enabled at no charge for CloudFront and Route 53.
    new SecurityStack(this, "Security", { apiHostname: api.apiHostname });
  }
}
