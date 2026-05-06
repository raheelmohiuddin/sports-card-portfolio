import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";

interface SecurityStackProps {
  apiHostname: string; // hostname only (no protocol), e.g. d7r0yfjooj.execute-api.us-east-1.amazonaws.com
}

export class SecurityStack extends Construct {
  public readonly cloudFrontUrl: string;

  constructor(scope: Construct, id: string, props: SecurityStackProps) {
    super(scope, id);

    // ─── WAF WebACL (CLOUDFRONT scope must be us-east-1, where this stack lives) ───
    const webAcl = new wafv2.CfnWebACL(this, "WebAcl", {
      name: "sports-card-portfolio-waf",
      scope: "CLOUDFRONT",
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: "sports-card-portfolio-waf",
        sampledRequestsEnabled: true,
      },
      rules: [
        // OWASP Top 10 — XSS, LFI, RFI, broken auth patterns, malicious bots, etc.
        managedRule("AWSManagedRulesCommonRuleSet", 1),
        // Dedicated SQL injection rule set (defence in depth — pg parameterised
        // queries already prevent SQLi at the query layer, but this catches
        // malicious payloads before they ever reach Lambda).
        managedRule("AWSManagedRulesSQLiRuleSet", 2),
        // Known bad inputs — log4j / Java deserialisation / known CVE patterns.
        managedRule("AWSManagedRulesKnownBadInputsRuleSet", 3),
        // Rate-based: 500 requests per 5-minute window per source IP (= 100/min).
        // 5 minutes is the minimum WAF window; the count is per IP.
        {
          name: "RateLimitPerIp",
          priority: 4,
          action: { block: {} },
          statement: {
            rateBasedStatement: { limit: 500, aggregateKeyType: "IP" },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "RateLimitPerIp",
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    // ─── Response headers policy — adds security headers at the edge ───
    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, "SecurityHeaders", {
      responseHeadersPolicyName: "sports-card-portfolio-security-headers",
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        xssProtection: { protection: true, modeBlock: true, override: true },
      },
    });

    // ─── CloudFront distribution in front of API Gateway ───
    // Adds: AWS Shield Standard (auto), edge DDoS absorption, TLS 1.2+ enforcement,
    // global anycast routing, and response-header injection.
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "Sports Card Portfolio — API CDN",
      defaultBehavior: {
        origin: new origins.HttpOrigin(props.apiHostname, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        // API responses must never be cached — CachingDisabled sets all TTLs to 0.
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        // Forward every header (including Authorization) and the Origin header so
        // API Gateway CORS still works — but strip Host so API Gateway can route correctly.
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        responseHeadersPolicy: securityHeaders,
        compress: false,
      },
      webAclId: webAcl.attrArn,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    this.cloudFrontUrl = `https://${distribution.distributionDomainName}`;

    new cdk.CfnOutput(this, "CloudFrontUrl", {
      value: this.cloudFrontUrl,
      description: "Use this as VITE_API_URL in frontend/.env.local",
    });
    new cdk.CfnOutput(this, "WebAclArn", {
      value: webAcl.attrArn,
      description: "WAF WebACL ARN — review CloudWatch metrics to monitor blocks",
    });
  }
}

function managedRule(name: string, priority: number): wafv2.CfnWebACL.RuleProperty {
  return {
    name,
    priority,
    overrideAction: { none: {} }, // honour the rule group's own actions (BLOCK / COUNT)
    statement: { managedRuleGroupStatement: { vendorName: "AWS", name } },
    visibilityConfig: {
      cloudWatchMetricsEnabled: true,
      metricName: name,
      sampledRequestsEnabled: true,
    },
  };
}
