# Setup Guide

## Prerequisites
- Node.js 20+
- AWS CLI configured (`aws configure`)
- AWS CDK installed (`npm install -g aws-cdk`)
- CDK bootstrapped (`cdk bootstrap` in your target account/region)

## 1. Install dependencies
```bash
cd infrastructure && npm install
cd ../backend && npm install
cd ../frontend && npm install
```

## 2. Deploy infrastructure
```bash
cd infrastructure
npx cdk deploy
```
Note the outputs — you'll need `UserPoolId`, `UserPoolClientId`, and `ApiEndpoint`.

## 3. Run database schema
Connect to your Aurora cluster (use RDS Query Editor in the AWS Console or a bastion)
and run `backend/db/schema.sql`.

## 4. Store your PSA API key
```bash
aws secretsmanager create-secret \
  --name sports-card-portfolio/psa-api-key \
  --secret-string '{"apiKey":"YOUR_PSA_API_KEY"}'
```
Get your PSA API key at: https://www.psacard.com/apis

## 5. Configure frontend
```bash
cp frontend/src/aws-exports.example.js frontend/src/aws-exports.js
# Edit aws-exports.js with your UserPoolId and UserPoolClientId

cp frontend/.env.local.example frontend/.env.local
# Edit .env.local with your ApiEndpoint URL
```

## 6. Run locally
```bash
cd frontend && npm run dev
```

## 7. Deploy to Amplify Hosting
1. Push this repo to GitHub/CodeCommit
2. In the AWS Amplify Console, connect the repo
3. Amplify will use `amplify.yml` for the build — no further config needed
4. Add environment variable `VITE_API_URL` in the Amplify Console

## Market Pricing (optional)
`backend/functions/portfolio/get-value.js` has a `fetchMarketValue()` stub.
Integrate one of:
- **eBay Finding API** (free, searches completed listings)
- **CardLadder API** (dedicated card pricing)
- **130point** (scraped eBay data)
