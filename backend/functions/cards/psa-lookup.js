const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");

const smClient = new SecretsManagerClient({});
let psaApiKey;

async function getPsaApiKey() {
  if (psaApiKey) return psaApiKey;
  const secret = await smClient.send(
    new GetSecretValueCommand({ SecretId: "sports-card-portfolio/psa-api-key" })
  );
  psaApiKey = JSON.parse(secret.SecretString).apiKey;
  return psaApiKey;
}

async function probeImage(url) {
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    return res.ok ? url : null;
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  const certNumber = event.pathParameters?.certNumber;
  if (!certNumber) {
    return { statusCode: 400, body: JSON.stringify({ error: "certNumber is required" }) };
  }

  const apiKey = await getPsaApiKey();
  const cdnBase = `https://d1htnxwo4o0jhw.cloudfront.net/cert/${certNumber}`;

  // Run API call and both image probes concurrently
  const [apiResponse, frontImageUrl, backImageUrl] = await Promise.all([
    fetch(`${process.env.PSA_API_BASE}/cert/GetByCertNumber/${certNumber}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    }),
    probeImage(`${cdnBase}/front.jpg`),
    probeImage(`${cdnBase}/back.jpg`),
  ]);

  if (!apiResponse.ok) {
    if (apiResponse.status === 404) {
      return { statusCode: 404, body: JSON.stringify({ error: "Certificate not found" }) };
    }
    return {
      statusCode: apiResponse.status,
      body: JSON.stringify({ error: "PSA API error" }),
    };
  }

  const data = await apiResponse.json();
  const cert = data.PSACert;

  const card = {
    certNumber: cert.CertNumber,
    year: cert.Year,
    brand: cert.Brand,
    sport: cert.Sport,
    playerName: cert.Subject,
    cardNumber: cert.CardNumber,
    grade: cert.CardGrade,
    gradeDescription: cert.GradeDescription,
    variety: cert.Variety,
    frontImageUrl,
    backImageUrl,
    psaData: cert,
  };

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(card),
  };
};
