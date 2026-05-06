// Copy this file to aws-exports.js and fill in values from `cdk deploy` outputs.
// aws-exports.js is git-ignored — never commit real credentials.

const awsExports = {
  Auth: {
    Cognito: {
      userPoolId: "us-east-1_XXXXXXXXX",          // UserPoolId output
      userPoolClientId: "XXXXXXXXXXXXXXXXXXXXXXXXXX", // UserPoolClientId output
      loginWith: { email: true },
    },
  },
};

export default awsExports;
