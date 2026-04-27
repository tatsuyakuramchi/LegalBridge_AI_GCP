import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Backlog Reorganization Script
 * This script will:
 * 1. Delete all issues in the project (as requested)
 * 2. Create high-fidelity Issue Types based on the provided design
 * 3. Create Custom Fields required for the contract generation templates
 */

const API_KEY = process.env.BACKLOG_API_KEY || '';
const HOST = (process.env.BACKLOG_HOST || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const PROJECT_KEY = process.env.BACKLOG_PROJECT_KEY || '';
const BASE_URL = `https://${HOST}/api/v2`;

if (!API_KEY || !HOST || !PROJECT_KEY) {
  console.error("❌ BACKLOG_API_KEY, BACKLOG_HOST, and BACKLOG_PROJECT_KEY are required in .env");
  process.exit(1);
}

const getUrl = (path: string) => `${BASE_URL}${path}?apiKey=${API_KEY}`;

async function run() {
  try {
    console.log("🚀 Starting Backlog Reorganization...");

    // 1. Get Project ID
    const projectRes = await axios.get(getUrl(`/projects/${PROJECT_KEY}`));
    const projectId = projectRes.data.id;
    console.log(`✅ Project Found: ${PROJECT_KEY} (ID: ${projectId})`);

    // 2. Delete All Issues (if any)
    console.log("\n🧹 [Phase 1] Deleting current issues...");
    let offset = 0;
    let totalDeleted = 0;
    while (true) {
      const issuesRes = await axios.get(getUrl('/issues'), {
        params: {
          "projectId[]": [projectId],
          count: 100,
          offset: offset
        }
      });
      const issues = issuesRes.data;
      if (issues.length === 0) break;

      for (const issue of issues) {
        await axios.delete(getUrl(`/issues/${issue.issueKey}`));
        console.log(`   - Deleted ${issue.issueKey}`);
        totalDeleted++;
        await new Promise(r => setTimeout(r, 200)); // Rate limit safety
      }
      // Since we are deleting, offset doesn't need to increase if we fetch again, 
      // but if we don't finish in one batch, we might need to retry.
      // Easiest is to just loop until count is 0.
    }
    console.log(`✅ Deleted ${totalDeleted} issues.`);

    // 3. Setup Issue Types
    console.log("\n🏗️ [Phase 2] Setting up Issue Types...");
    const desiredIssueTypes = [
      { name: 'license_master', color: '#7ea800' }, 
      { name: 'lic_individual', color: '#7ea800' },
      { name: 'manufacturing', color: '#ff9200' },
      { name: 'outsourcing', color: '#814fbc' },
      { name: 'purchase_order', color: '#2779ca' },
      { name: 'delivery_inspec', color: '#007e9a' },
      { name: 'payment', color: '#666665' },
      { name: 'sales_master', color: '#ff9200' },
      { name: 'legal_consult', color: '#e30000' },
      { name: 'nda', color: '#2779ca' }
    ];

    const currentIssueTypesRes = await axios.get(getUrl(`/projects/${projectId}/issueTypes`));
    const currentTypes = currentIssueTypesRes.data;

    for (const type of desiredIssueTypes) {
      const existing = currentTypes.find((t: any) => t.name === type.name);
      if (!existing) {
        const body = new URLSearchParams();
        body.append('name', type.name);
        body.append('color', type.color);
        const res = await axios.post(getUrl(`/projects/${projectId}/issueTypes`), body);
        console.log(`   + Created Issue Type: ${type.name} (ID: ${res.data.id})`);
      } else {
        console.log(`   . Issue Type exists: ${type.name}`);
      }
    }

    // 4. Setup Custom Fields
    console.log("\n📑 [Phase 3] Setting up Custom Fields...");
    const desiredFields = [
      { name: 'Licensor_名称', type: 1 }, // 1: Text
      { name: 'Licensor_住所', type: 1 },
      { name: 'Licensor_代表者名', type: 1 },
      { name: 'Licensee_名称', type: 1 },
      { name: 'Licensee_住所', type: 1 },
      { name: 'Licensee_代表者名', type: 1 },
      { name: '契約日', type: 4 }, // 4: Date
      { name: 'MG金額', type: 3 }, // 3: Numeric
      { name: '料率', type: 2 },    // 2: TextArea
      { name: '検収日', type: 4 },
      { name: '支払予定日', type: 4 },
      { name: '取引先', type: 1 },
      { name: '商品名', type: 1 },
      { name: '発注番号', type: 1 }
    ];

    const currentFieldsRes = await axios.get(getUrl(`/projects/${projectId}/customFields`));
    const currentFields = currentFieldsRes.data;

    for (const field of desiredFields) {
      const existing = currentFields.find((f: any) => f.name === field.name);
      if (!existing) {
        const body = new URLSearchParams();
        body.append('name', field.name);
        body.append('typeId', field.type.toString());
        // For project-wide custom fields, we might need to specify issue types. 
        // If omitted, it usually applies to all.
        const res = await axios.post(getUrl(`/projects/${projectId}/customFields`), body);
        console.log(`   + Created Custom Field: ${field.name} (ID: ${res.data.id})`);
      } else {
        console.log(`   . Custom Field exists: ${field.name} (ID: ${existing.id})`);
      }
    }

    console.log("\n✨ Backlog Setup Complete!");
    console.log("--------------------------------------------------");
    console.log("Please check your Backlog project and update your .env with any new IDs if necessary.");
    console.log("--------------------------------------------------");

  } catch (err: any) {
    console.error("❌ Error during setup:");
    if (err.response) {
      console.error(err.response.data);
    } else {
      console.error(err.message);
    }
  }
}

run();
