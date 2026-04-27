import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Backlog Data Reseeding Script
 * This script will create sample issues using the NEW issue types and custom fields.
 * It demonstrates the 3-level hierarchy (Master -> Detailed -> Manufacturing) described in the design.
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
    console.log("🚀 Starting Backlog Data Reseeding...");

    // 1. Get Project/Meta Data
    const projectRes = await axios.get(getUrl(`/projects/${PROJECT_KEY}`));
    const projectId = projectRes.data.id;
    
    const issueTypesRes = await axios.get(getUrl(`/projects/${projectId}/issueTypes`));
    const issueTypes = issueTypesRes.data;

    const customFieldsRes = await axios.get(getUrl(`/projects/${projectId}/customFields`));
    const customFields = customFieldsRes.data;

    const getTypeId = (name: string) => issueTypes.find((t: any) => t.name === name)?.id;
    const getFieldId = (name: string) => customFields.find((f: any) => f.name === name)?.id;

    // Helper to create issue
    const create = async (summary: string, typeName: string, parentId?: number, fields: Record<string, any> = {}) => {
      const typeId = getTypeId(typeName);
      if (!typeId) {
        console.warn(`⚠️ Issue Type not found: ${typeName}`);
        return null;
      }

      const body = new URLSearchParams();
      body.append('projectId', projectId.toString());
      body.append('summary', summary);
      body.append('issueTypeId', typeId.toString());
      body.append('priorityId', '3'); // Normal
      if (parentId) body.append('parentIssueId', parentId.toString());
      
      Object.keys(fields).forEach(name => {
        const fid = getFieldId(name);
        if (fid) {
          body.append(`customField_${fid}`, fields[name]);
        }
      });

      const res = await axios.post(getUrl('/issues'), body);
      console.log(`   + Created [${typeName}] ${res.data.issueKey}: ${summary}`);
      return res.data;
    };

    console.log("\n📁 [Level 1] Creating License Master Agreement...");
    const master = await create("ライセンス基本契約：アークライト × サンプル物産", "license_master", undefined, {
      "Licensor_名称": "サンプル物産株式会社",
      "Licensor_代表者名": "サンプル 太郎",
      "Licensee_名称": "株式会社アークライト",
      "契約日": "2024-04-01"
    });

    if (master) {
      console.log("\n📄 [Level 2] Creating Individual License Terms...");
      const individual = await create("個別利用許諾：商品A プロジェクト", "lic_individual", master.id, {
        "商品名": "商品A",
        "MG金額": "1000000",
        "料率": "5% (販売価格ベース)"
      });

      if (individual) {
        console.log("\n⚙️ [Level 3] Creating Manufacturing Event (Sibling to Individual)...");
        await create("製造案件：商品A 第1回ロット(1000個)", "manufacturing", master.id, {
          "商品名": "商品A",
          "発注番号": "PO-2024-001"
        });
      }
    }

    console.log("\n📦 [Commercial] Creating Sales Master Agreement...");
    await create("売買基本契約：アークライト × 流通センター", "sales_master", undefined, {
      "取引先": "流通センター株式会社",
      "契約日": "2024-05-15"
    });

    console.log("\n💡 [NDA] Creating Non-Disclosure Agreement...");
    await create("秘密保持契約 (NDA)：新規プロジェクト調査", "nda", undefined, {
      "取引先": "テックパートナーズ",
      "契約日": "2024-04-20"
    });

    console.log("\n⚖️ [Consult] Creating Legal Consultation...");
    await create("新規事業のリーガルチェック依頼", "legal_consult", undefined);

    console.log("\n✨ Reseeding Complete!");

  } catch (err: any) {
    console.error("❌ Error during reseed:");
    if (err.response) {
      console.error(err.response.data);
    } else {
      console.error(err.message);
    }
  }
}

run();
