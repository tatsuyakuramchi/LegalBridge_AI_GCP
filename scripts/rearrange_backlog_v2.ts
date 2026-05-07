import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Backlog Reorganization Script V2
 * 
 * This script refreshes the Backlog project:
 * 1. Deletes all existing Custom Fields.
 * 2. Deletes all non-default Issue Types.
 * 3. Sets up a new, streamlined structure for document workflow control.
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
    console.log("🚀 Starting Backlog Refresh (V2)...");

    // 1. Get Project ID
    const projectRes = await axios.get(getUrl(`/projects/${PROJECT_KEY}`));
    const projectId = projectRes.data.id;
    console.log(`✅ Project Found: ${PROJECT_KEY} (ID: ${projectId})`);

    // 2. Cleanup Custom Fields
    console.log("\n🧹 [Phase 1] Deleting old Custom Fields...");
    const currentFieldsRes = await axios.get(getUrl(`/projects/${projectId}/customFields`));
    for (const field of currentFieldsRes.data) {
      await axios.delete(getUrl(`/projects/${projectId}/customFields/${field.id}`));
      console.log(`   - Deleted Custom Field: ${field.name}`);
      await new Promise(r => setTimeout(r, 300));
    }

    // 3. Cleanup Issue Types
    console.log("\n🧹 [Phase 2] Deleting old Issue Types...");
    const currentTypesRes = await axios.get(getUrl(`/projects/${projectId}/issueTypes`));
    // Backlog requires at least one issue type, so we skip the one named 'Task' or just keep one.
    // Usually, the first one cannot be deleted.
    const defaultType = currentTypesRes.data[0];
    for (const type of currentTypesRes.data) {
      if (type.id === defaultType.id) continue;
      try {
        await axios.delete(getUrl(`/projects/${projectId}/issueTypes/${type.id}`), {
            params: { substituteIssueTypeId: defaultType.id }
        });
        console.log(`   - Deleted Issue Type: ${type.name}`);
      } catch (e) {
        console.warn(`   ! Could not delete issue type ${type.name} (it might be in use or default)`);
      }
      await new Promise(r => setTimeout(r, 500));
    }

    // 4. Setup New Issue Types
    console.log("\n🏗️ [Phase 3] Setting up New Issue Types...");
    const newIssueTypes = [
      { name: '契約審査', color: '#e30000' }, 
      { name: '法務相談', color: '#2779ca' },
      { name: '事務手続', color: '#666665' },
      { name: '納品・検収', color: '#7ea800' },
      { name: '利用許諾計算', color: '#ff9200' }
    ];
    for (const it of newIssueTypes) {
      const body = new URLSearchParams();
      body.append('name', it.name);
      body.append('color', it.color);
      const res = await axios.post(getUrl(`/projects/${projectId}/issueTypes`), body);
      console.log(`   + Created Issue Type: ${it.name} (ID: ${res.data.id})`);
    }

    // 5. Setup New Custom Fields
    console.log("\n📑 [Phase 4] Setting up New Custom Fields...");
    const newFields = [
      { name: '取引先名称', type: 1 }, 
      { name: '依頼部署', type: 1 },
      { name: 'ドラフトURL', type: 1 },
      { name: '締結方法', type: 5, items: ['クラウドサイン', '紙捺印', 'その他'] },
      { name: '締結予定日', type: 4 },
      { name: '希望納期', type: 4 },
      { name: '文書番号', type: 1 },
      { name: '備考', type: 1 }
    ];

    for (const field of newFields) {
      const body = new URLSearchParams();
      body.append('name', field.name);
      body.append('typeId', field.type.toString());
      if (field.items) {
        field.items.forEach(item => body.append('items[]', item));
      }
      try {
        const res = await axios.post(getUrl(`/projects/${projectId}/customFields`), body);
        console.log(`   + Created Custom Field: ${field.name} (ID: ${res.data.id})`);
      } catch (e: any) {
        console.warn(`   ! Could not create field ${field.name}`);
      }
      await new Promise(r => setTimeout(r, 500));
    }

    // 6. Custom Statuses
    console.log("\n🚦 [Phase 5] Setting up Custom Statuses...");
    const currentStatusesRes = await axios.get(getUrl(`/projects/${projectId}/statuses`));
    const currentStatuses = currentStatusesRes.data;
    
    // Delete all existing custom statuses (IDs > 4)
    for (const status of currentStatuses) {
      if (status.id > 4) {
        try {
          await axios.delete(getUrl(`/projects/${projectId}/statuses/${status.id}`));
          console.log(`   - Deleted Custom Status: ${status.name}`);
        } catch (e) {
          console.warn(`   ! Could not delete status ${status.name} (might be in use)`);
        }
        await new Promise(r => setTimeout(r, 600));
      }
    }

    const newStatuses = [
      { name: '法務審査中', color: '#ff9200' },
      { name: '相手方確認中', color: '#007e9a' },
      { name: '社内承認中', color: '#7ea800' },
      { name: '締結手続中', color: '#814fbc' }
    ];

    for (const st of newStatuses) {
      try {
        const body = new URLSearchParams();
        body.append('name', st.name);
        body.append('color', st.color);
        const res = await axios.post(getUrl(`/projects/${projectId}/statuses`), body);
        console.log(`   + Created Custom Status: ${st.name} (ID: ${res.data.id})`);
      } catch (e) {
        console.warn(`   ! Could not create status ${st.name} (your plan might not support custom statuses)`);
      }
      await new Promise(r => setTimeout(r, 600));
    }

    // 7. Setup Categories
    console.log("\n📁 [Phase 6] Setting up Categories...");
    const currentCategoriesRes = await axios.get(getUrl(`/projects/${projectId}/categories`));
    for (const cat of currentCategoriesRes.data) {
      try {
        await axios.delete(getUrl(`/projects/${projectId}/categories/${cat.id}`));
        console.log(`   - Deleted Category: ${cat.name}`);
      } catch (e) {
        console.warn(`   ! Could not delete category ${cat.name}`);
      }
      await new Promise(r => setTimeout(r, 300));
    }

    const newCategories = [
      '契約', '発注', '納品', '売買', 'ライセンス', '通知書'
    ];

    for (const catName of newCategories) {
      try {
        const body = new URLSearchParams();
        body.append('name', catName);
        const res = await axios.post(getUrl(`/projects/${projectId}/categories`), body);
        console.log(`   + Created Category: ${catName} (ID: ${res.data.id})`);
      } catch (e) {
        console.warn(`   ! Could not create category ${catName}`);
      }
      await new Promise(r => setTimeout(r, 300));
    }

    console.log("\n✨ Backlog Refresh Complete!");
    console.log("--------------------------------------------------");
    console.log("The following structure is now active:");
    console.log("- Types: 契約審査, 法務相談, 事務手続, 納品・検収, 利用許諾計算");
    console.log("- Fields: 取引先名称, 依頼部署, ドラフトURL, 締結方法, 締結予定日, 備考");
    console.log("- Categories: 契約, 発注, 納品, 売買, ライセンス, 通知書");
    console.log("- Statuses (if supported): 法務審査中, 相手方確認中, 社内承認中, 締結手続中");
    console.log("--------------------------------------------------");

  } catch (err: any) {
    console.error("❌ Error during refresh:");
    if (err.response) {
      console.error(JSON.stringify(err.response.data, null, 2));
    } else {
      console.error(err.message);
    }
  }
}

run();
