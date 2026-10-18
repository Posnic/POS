# OBC full-catalogue matching rollout

The cloud-only HKTV order store now decorates product options and known-SKU checks with the connector's validated full-catalogue view. Tenant database, licence, branch and store must match the connector configuration and the snapshot. Deploy src/product-catalogue-view.cjs in the configured connector root before deploying this service change. The existing authenticated endpoint and extension read permission remain in force.

OBC signed UI 0.3.13 and the cloud service are deployed. Live readback returned 1,085 unique products over 11 pages. Chrome name search for ASHWIN displayed two products and the catalogue capture time. This corrects the former restriction to SKUs from imported order lines. No product mappings were written during rollout.

The catalogue is a cloud-authoritative snapshot exposed by authenticated reads, not a new writable local collection. No Gateway/agent lane is added. Connected tills must use that cloud view; offline access is unavailable. Actual till connectivity remains unverified. No stock publishing, payment posting or provider status update was enabled. See the extension repository's docs/full-catalogue-rollout.md for snapshot provenance, rollout and remaining bulk-upload work.
