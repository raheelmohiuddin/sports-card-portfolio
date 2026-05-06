import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export class StorageStack extends Construct {
  public readonly cardImagesBucket: s3.Bucket;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.cardImagesBucket = new s3.Bucket(this, "CardImages", {
      bucketName: `sports-card-images-${cdk.Aws.ACCOUNT_ID}`,
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.HEAD],
          allowedOrigins: ["*"], // Restrict to your Amplify domain in production
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag", "Content-Type", "Content-Length"],
          maxAge: 3600,
        },
      ],
      lifecycleRules: [
        {
          // Clean up incomplete multipart uploads
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Defense in depth: deny any non-TLS request to the bucket. BlockPublicAccess
    // already prevents public ACLs/policies, but this ensures every accepted
    // request — including signed URLs — is over HTTPS.
    this.cardImagesBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: "DenyNonSslRequests",
      effect: iam.Effect.DENY,
      principals: [new iam.AnyPrincipal()],
      actions: ["s3:*"],
      resources: [
        this.cardImagesBucket.bucketArn,
        this.cardImagesBucket.arnForObjects("*"),
      ],
      conditions: { Bool: { "aws:SecureTransport": "false" } },
    }));

    new cdk.CfnOutput(this, "CardImagesBucketName", {
      value: this.cardImagesBucket.bucketName,
    });
  }
}
