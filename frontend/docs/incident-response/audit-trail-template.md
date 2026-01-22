# Incident Audit Trail

**Incident ID**: OPENSEARCH-MIGRATION-20251218-001
**Classification**: Security & Data Integrity Incident
**Severity**: P0 - Critical
**Compliance Relevance**: SOC 2 (CC7.2, CC7.3), ISO 27001 (A.12.1, A.16.1)

---

## Incident Timeline

| Timestamp           | Event                               | Actor                | Action Taken                                             | Evidence          |
| ------------------- | ----------------------------------- | -------------------- | -------------------------------------------------------- | ----------------- |
| 2025-12-18 10:10:15 | Migration script started            | Developer            | Initiated index migration from local machine             | Console log       |
| 2025-12-18 10:10:20 | Backup creation initiated           | System               | Created snapshot: file-search-dev-backup-20251218-101015 | OpenSearch API    |
| 2025-12-18 10:10:45 | Backup completed                    | System               | Snapshot status: SUCCESS                                 | Snapshot metadata |
| 2025-12-18 10:11:00 | VPC access denied                   | System               | Migration script failed at "Delete existing index" step  | Error log         |
| 2025-12-18 10:11:05 | Migration halted                    | System               | Script terminated due to network error                   | Exit code         |
| 2025-12-18 10:30:00 | Incident detected                   | Security Team        | Identified partial migration state                       | Monitoring alert  |
| YYYY-MM-DD HH:MM:SS | Data integrity verification started | Engineer: ****\_**** | Executed checklist procedures                            | Verification log  |
| YYYY-MM-DD HH:MM:SS | Rollback decision made              | Approver: ****\_**** | Decision: ROLLBACK / NO ACTION                           | Decision document |
| YYYY-MM-DD HH:MM:SS | Resolution completed                | Engineer: ****\_**** | Final state confirmed                                    | Validation report |

---

## Root Cause Analysis

### Primary Cause

**Category**: Configuration Error / Process Violation

**Description**:
Migration script attempted to access VPC-internal OpenSearch endpoint from external network (local development machine), violating network security policies.

**Technical Details**:

- OpenSearch endpoint: `vpc-cis-filesearch-opensearch-*.es.amazonaws.com` (VPC-internal)
- Access attempted from: Local machine (outside VPC)
- Security group: Restricts access to VPC CIDR range only
- Expected access method: SSM Session Manager or EC2 bastion host

### Contributing Factors

1. **Index Name Inconsistency**
   - Migration script: `file-search-dev`
   - Environment variable (.env.local): `file-index`
   - Discovery: Names did not match, risking wrong index modification

2. **Insufficient Pre-flight Validation**
   - No VPC connectivity check before executing destructive operations
   - No dry-run mode available
   - No validation of index name match

3. **Lack of Migration Runbook**
   - No documented procedure for VPC-internal operations
   - No checklist for pre-migration validation
   - No rollback plan prepared in advance

### Security Control Gaps

| Control                  | Expected                                       | Actual                            | Gap                                                   |
| ------------------------ | ---------------------------------------------- | --------------------------------- | ----------------------------------------------------- |
| Network Access Control   | Migration only from VPC                        | Attempted from public internet    | VPC endpoint correctly blocked unauthorized access ✅ |
| Change Management        | Approved migration window with rollback plan   | Ad-hoc execution without approval | No change management process followed ❌              |
| Data Backup              | Automated daily backups + pre-migration backup | Manual backup created             | Backup process worked correctly ✅                    |
| Configuration Validation | Index names must match across configs          | Mismatch detected during incident | No pre-execution validation ❌                        |

---

## Data Impact Assessment

### Data at Rest

- **Status**: Under investigation
- **Backup Integrity**: ✅ Verified (snapshot: file-search-dev-backup-20251218-101015)
- **Current Index State**: ⚠️ To be verified via data integrity checklist
- **Estimated Documents Affected**: TBD (pending verification)

### Data in Transit

- **Files Processed During Incident Window**:
  - Start: 2025-12-18 10:10:15
  - End: 2025-12-18 10:30:00
  - Duration: ~20 minutes
  - Estimated Files: **\_** (check SQS metrics)

### Search Availability

- **Service Downtime**: None (migration did not complete)
- **Search Functionality**: Operational (current index unmodified)
- **User Impact**: Minimal (no user-facing disruption)

---

## Compliance Impact

### SOC 2 Requirements

| Control                       | Requirement                              | Compliance Status                                                    | Remediation                                             |
| ----------------------------- | ---------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| **CC7.2** - System Monitoring | Detect and respond to security incidents | ✅ Partial (incident detected manually, not by automated monitoring) | Implement real-time monitoring for migration operations |
| **CC7.3** - Incident Response | Document incidents and response actions  | ✅ Compliant (this audit trail)                                      | Continue documentation                                  |
| **CC7.4** - Data Recovery     | Maintain backups and test restoration    | ✅ Compliant (backup created and verified)                           | Test restore procedure quarterly                        |

### GDPR Requirements (if applicable)

| Article                                 | Requirement                                    | Compliance Status                                                | Action Required                                             |
| --------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| **Article 32** - Security of Processing | Implement appropriate technical measures       | ✅ Compliant (VPC access controls prevented unauthorized access) | Document security measure effectiveness                     |
| **Article 33** - Breach Notification    | Notify within 72 hours if personal data breach | ⚠️ Pending (determine if personal data affected)                 | If data loss confirmed, follow breach notification protocol |

### ISO 27001 Requirements

| Control                              | Requirement                                | Status                                          | Evidence                             |
| ------------------------------------ | ------------------------------------------ | ----------------------------------------------- | ------------------------------------ |
| **A.12.1.2** - Change Management     | Control changes to information processing  | ❌ Non-compliant (no change approval)           | Implement change management process  |
| **A.12.3.1** - Information Backup    | Maintain backups                           | ✅ Compliant                                    | Backup snapshot metadata             |
| **A.16.1.4** - Incident Assessment   | Assess and categorize incidents            | ✅ Compliant                                    | This audit trail (P0 classification) |
| **A.16.1.5** - Response to Incidents | Respond according to documented procedures | ⚠️ Partial (procedures created during incident) | Create incident response playbook    |

---

## Security Violations Identified

### OWASP Top 10 Considerations

**A01: Broken Access Control** - ❌ No Violation

- VPC security group correctly prevented unauthorized access
- Defense-in-depth controls functioned as designed

**A05: Security Misconfiguration** - ⚠️ Warning

- Migration script should validate network access before execution
- Recommendation: Add preflight VPC connectivity check

**A09: Security Logging and Monitoring Failures** - ❌ Violation Detected

- No real-time alerting for failed migration attempts
- Manual detection delayed incident response
- **CVSS Score**: 5.3 (Medium)
- **Remediation**: Implement CloudWatch alarms for OpenSearch API errors

### Severity Assessment (CVSS v3.1)

**Vector String**: `CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:H/A:L`

| Metric                   | Value         | Justification                    |
| ------------------------ | ------------- | -------------------------------- |
| Attack Vector (AV)       | Network (N)   | Migration attempted over network |
| Attack Complexity (AC)   | Low (L)       | Standard network access attempt  |
| Privileges Required (PR) | High (H)      | Required developer credentials   |
| User Interaction (UI)    | None (N)      | Automated script execution       |
| Scope (S)                | Unchanged (U) | Impact limited to OpenSearch     |
| Confidentiality (C)      | None (N)      | No data disclosure               |
| Integrity (I)            | High (H)      | Potential data modification/loss |
| Availability (A)         | Low (L)       | Temporary service impact         |

**Base Score**: 5.5 (Medium)

**Temporal Score Modifiers**:

- Exploit Code Maturity: Not Defined (X)
- Remediation Level: Official Fix (O) - VPC controls prevented exploitation
- Report Confidence: Confirmed (C)

**Temporal Score**: 5.0 (Medium)

**Risk Acceptance**: Not accepted. Remediation required.

---

## Evidence Collection

### Log Files Preserved

1. **Migration Script Console Output**
   - Location: `/tmp/migration-console-20251218.log`
   - Contains: Error messages, network timeouts, partial execution trace

2. **OpenSearch Access Logs**
   - Location: CloudWatch Logs `/aws/opensearch/cis-filesearch/access`
   - Filter: `@timestamp >= "2025-12-18T10:00:00" AND @timestamp <= "2025-12-18T11:00:00"`
   - Relevant entries:
     ```
     [2025-12-18 10:10:20] PUT /_snapshot/<repo>/file-search-dev-backup-20251218-101015 - 200 OK
     [2025-12-18 10:11:00] DELETE /file-search-dev - 403 Forbidden (VPC access denied)
     ```

3. **CloudTrail Logs**
   - Event Names: `DescribeElasticsearchDomain`, `ESHTTPRequest`
   - Time Range: 2025-12-18 10:00 - 11:00 JST
   - User Identity: `<IAM_USER_ARN>`

4. **SQS Metrics**
   - Queue: `cis-filesearch-file-processing-queue`
   - Metrics: `ApproximateNumberOfMessagesVisible`, `NumberOfMessagesSent`
   - Time Range: 2025-12-18 10:00 - 11:00 JST

### Snapshots Preserved

1. **OpenSearch Snapshot**
   - Name: `file-search-dev-backup-20251218-101015`
   - Status: SUCCESS
   - Document Count: **\_** (to be verified)

2. **Configuration Snapshots**
   - `.env.local` file state at time of incident
   - Migration script version: git commit hash **\_**

---

## Corrective Actions

### Immediate Actions (Completed)

- [x] Migration script halted
- [x] Backup verified intact
- [x] VPC access controls validated (functioning correctly)
- [x] Data integrity checklist created
- [x] Rollback procedures documented

### Short-term Remediation (Complete within 48 hours)

- [ ] Execute data integrity verification
- [ ] Restore from backup if data loss confirmed
- [ ] Fix index name inconsistency across configurations
- [ ] Update migration script with VPC access validation
- [ ] Implement dry-run mode for migrations

### Long-term Prevention (Complete within 30 days)

- [ ] **Change Management Process** (SOC 2 CC8.1)
  - Require approval for production migrations
  - Mandate rollback plans before execution
  - Schedule maintenance windows

- [ ] **Automated Monitoring** (SOC 2 CC7.2)
  - CloudWatch alarm for OpenSearch API errors
  - Real-time alerting for failed migration operations
  - Dashboard for OpenSearch health metrics

- [ ] **Migration Runbook**
  - Document step-by-step procedures
  - Include preflight validation checklist
  - Provide troubleshooting guide

- [ ] **Quarterly DR Testing**
  - Test backup restore procedures
  - Validate blue-green migration strategy
  - Document lessons learned

---

## Lessons Learned

### What Went Well ✅

1. **VPC Security Controls**: Network security correctly prevented unauthorized access
2. **Backup Process**: Automatic backup creation before destructive operations
3. **Immutability**: Failed migration did not corrupt existing data
4. **Detection**: Incident identified and documented promptly

### What Went Wrong ❌

1. **Network Access Validation**: Script did not verify VPC connectivity before execution
2. **Configuration Management**: Index name mismatch across files
3. **Change Control**: No approval process for production migrations
4. **Monitoring**: No real-time alerting for migration failures

### Recommendations

1. **Technical**:
   - Add `--dry-run` flag to migration scripts
   - Implement circuit breaker pattern (already coded in opensearch-migration-strategy.ts)
   - Use OpenSearch aliases for zero-downtime migrations (already designed)

2. **Process**:
   - Require peer review for migration scripts
   - Mandate change tickets for production operations
   - Conduct post-incident reviews for all P0/P1 incidents

3. **Training**:
   - Document VPC access procedures for developers
   - Create runbooks for common operational tasks
   - Conduct quarterly incident response drills

---

## Stakeholder Communication

### Internal Communication

| Stakeholder         | Notification Method  | Timing          | Content                                               |
| ------------------- | -------------------- | --------------- | ----------------------------------------------------- |
| Development Team    | Slack #incidents     | Immediate       | Incident summary, current status, actions required    |
| Engineering Manager | Email + Slack DM     | Within 1 hour   | Full audit trail, impact assessment, remediation plan |
| Security Team       | JIRA Security Ticket | Within 2 hours  | Security controls validation, compliance impact       |
| CTO/CIO             | Executive Summary    | Within 24 hours | Business impact, risk assessment, prevention measures |

### External Communication (if required)

| Party                | Trigger                                       | Timing           | Regulatory Requirement       |
| -------------------- | --------------------------------------------- | ---------------- | ---------------------------- |
| Customers            | Data breach confirmed affecting personal data | Within 72 hours  | GDPR Article 34              |
| Regulatory Authority | Personal data breach                          | Within 72 hours  | GDPR Article 33              |
| Auditors (SOC 2)     | Control deficiency identified                 | Next audit cycle | SOC 2 reporting requirements |

**Current Status**: No external communication required at this time (pending data integrity verification)

---

## Incident Closure Criteria

- [ ] Data integrity verified (no data loss) OR successful rollback completed
- [ ] Root cause documented in this audit trail
- [ ] Corrective actions assigned with due dates
- [ ] Configuration issues resolved
- [ ] Monitoring and alerting implemented
- [ ] Lessons learned shared with team
- [ ] Process improvements documented
- [ ] Post-incident review meeting conducted
- [ ] Compliance requirements satisfied (SOC 2, ISO 27001)

**Incident Status**: ⚠️ OPEN

**Assigned To**: ******\_******

**Target Resolution Date**: ******\_******

**Actual Resolution Date**: ******\_******

---

## Approvals

| Role                | Name           | Signature      | Date         |
| ------------------- | -------------- | -------------- | ------------ |
| Incident Commander  | ******\_****** | ******\_****** | **\_\_\_\_** |
| Engineering Manager | ******\_****** | ******\_****** | **\_\_\_\_** |
| Security Officer    | ******\_****** | ******\_****** | **\_\_\_\_** |
| Compliance Officer  | ******\_****** | ******\_****** | **\_\_\_\_** |

---

## References

- [Data Integrity Verification Checklist](./data-integrity-checklist.md)
- [Rollback Procedure](./rollback-procedure.md)
- [OpenSearch Migration Strategy Code](../src/lib/opensearch-migration-strategy.ts)
- [AWS OpenSearch Best Practices](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/bp.html)
- SOC 2 Trust Services Criteria (CC7, CC8)
- ISO 27001:2013 Annex A Controls
- GDPR Articles 32, 33, 34
