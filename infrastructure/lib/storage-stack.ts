import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
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
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT],
          allowedOrigins: ["*"], // Restrict to your Amplify domain in production
          allowedHeaders: ["*"],
          maxAge: 3000,
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

    new cdk.CfnOutput(this, "CardImagesBucketName", {
      value: this.cardImagesBucket.bucketName,
    });
  }
}
