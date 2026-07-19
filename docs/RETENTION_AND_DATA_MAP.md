# Retention and Data Map — Template

| Data | Default | Purpose | Access |
|---|---:|---|---|
| Source message copy and AI decision | 30 days | Intake evidence and correction | Employee, team approver, auditor |
| Pending/completed action metadata | 30 days, then retain external ID only if required | Workflow audit | Approver, auditor |
| Consent/notice acknowledgement | Employment plus applicable limitation period | Accountability | Privacy admins |
| Privacy requests | Per legal/request schedule | Rights handling | Privacy admins |
| OAuth sessions/tokens | 8 hours/session; revoke on logout | Authentication and delegated mail | Authentication service only |
| Security logs | 30–90 days according to risk | Detection and investigation | Security operations |
| Jira/Confluence/Slack/Outlook content | Destination-system policy | Operational record | Destination RBAC |

The employer must replace defaults with an approved schedule. Legal holds must be documented and scoped. Logs must not contain message bodies, transcripts, tokens, secrets, or unnecessary identifiers.
