import axios from "axios";

export interface BacklogIssueParams {
  summary: string;
  description: string;
  issueTypeId: number;
  priorityId: number;
  [key: string]: any;
}

export class BacklogService {
  private baseUrl: string;
  private apiKey: string;
  private projectKey: string;

  constructor() {
    let host = process.env.BACKLOG_HOST || "";
    // Remove https:// or http:// if present
    host = host.replace(/^https?:\/\//, "").replace(/\/$/, "");
    
    this.baseUrl = host ? `https://${host}/api/v2` : "";
    this.apiKey = process.env.BACKLOG_API_KEY || "";
    this.projectKey = process.env.BACKLOG_PROJECT_KEY || "";
  }

  private getUrl(path: string) {
    return `${this.baseUrl}${path}?apiKey=${this.apiKey}`;
  }

  async createIssue(params: BacklogIssueParams): Promise<any> {
    if (!this.apiKey || !this.baseUrl) {
      console.warn("⚠️ Backlog credentials missing. Mocking issue creation.");
      return { issueKey: `MOCK-${Math.floor(Math.random() * 1000)}` };
    }

    try {
      // Get Project ID first
      const projectRes = await axios.get(this.getUrl(`/projects/${this.projectKey}`));
      const projectId = projectRes.data.id;

      const body = new URLSearchParams();
      body.append("projectId", projectId.toString());
      body.append("summary", params.summary);
      body.append("description", params.description);
      body.append("issueTypeId", params.issueTypeId.toString());
      body.append("priorityId", params.priorityId.toString());

      // Section 1-1: Mapping custom fields from environment variables
      const fieldMapping: Record<string, string | undefined> = {
        contractDate: process.env.BACKLOG_FIELD_CONTRACT_DATE,
        contractPeriod: process.env.BACKLOG_FIELD_CONTRACT_PERIOD,
        remarks: process.env.BACKLOG_FIELD_REMARKS,
        contractNo: process.env.BACKLOG_FIELD_CONTRACT_NO,
        projectTitle: process.env.BACKLOG_FIELD_PROJECT_TITLE,
        counterparty: process.env.BACKLOG_FIELD_COUNTERPARTY || process.env.BACKLOG_FIELD_PARTY_B_NAME,
        deadline: process.env.BACKLOG_FIELD_DEADLINE || process.env.BACKLOG_FIELD_FINAL_DEADLINE,
      };

      // Add custom fields if any
      Object.keys(params).forEach(key => {
        if (!["summary", "description", "issueTypeId", "priorityId"].includes(key)) {
          const fieldId = fieldMapping[key];
          if (fieldId) {
            body.append(`customField_${fieldId}`, params[key]);
          } else {
            // Fallback for direct IDs or other fields
            body.append(key, params[key]);
          }
        }
      });

      const response = await axios.post(this.getUrl("/issues"), body);
      return response.data;
    } catch (error) {
      console.error("Error creating Backlog issue:", error);
      throw error;
    }
  }

  async getIssue(issueKey: string): Promise<any> {
    try {
      const response = await axios.get(this.getUrl(`/issues/${issueKey}`));
      return response.data;
    } catch (error) {
      console.error(`Error fetching Backlog issue ${issueKey}:`, error);
      throw error;
    }
  }

  async getIssues(): Promise<any[]> {
    if (!this.apiKey || !this.baseUrl || !this.projectKey) {
      console.warn("⚠️ Backlog credentials (API_KEY, HOST, or PROJECT_KEY) missing.", {
        hasKey: !!this.apiKey,
        baseUrl: this.baseUrl,
        projectKey: this.projectKey
      });
      return [];
    }
    try {
      console.log(`🔍 Fetching project ID for: ${this.projectKey}`);
      const projectRes = await axios.get(this.getUrl(`/projects/${this.projectKey}`));
      const projectId = projectRes.data.id;
      console.log(`✅ Project ID found: ${projectId}`);

      const response = await axios.get(this.getUrl("/issues"), {
        params: {
          "projectId[]": [projectId],
          count: 100 // Fetch a larger batch. For true "all", pagination would be needed.
        }
      });
      console.log(`✅ Fetched ${response.data.length} issues from Backlog`);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error("❌ Backlog API Error:", {
          status: error.response?.status,
          message: error.message,
          data: error.response?.data,
          url: error.config?.url?.replace(/apiKey=.*$/, "apiKey=HIDDEN")
        });
      } else {
        console.error("❌ Error fetching Backlog issues:", error);
      }
      return [];
    }
  }

  async getIssueTypes(): Promise<any[]> {
    if (!this.apiKey || !this.baseUrl || !this.projectKey) return [];
    try {
      const response = await axios.get(this.getUrl(`/projects/${this.projectKey}/issueTypes`));
      return response.data;
    } catch (error) {
      console.error("Error fetching issue types:", error);
      return [];
    }
  }

  async getCustomFields(): Promise<any[]> {
    if (!this.apiKey || !this.baseUrl || !this.projectKey) return [];
    try {
      const response = await axios.get(this.getUrl(`/projects/${this.projectKey}/customFields`));
      return response.data;
    } catch (error) {
      console.error("Error fetching custom fields:", error);
      return [];
    }
  }

  async getStatuses(): Promise<any[]> {
    if (!this.apiKey || !this.baseUrl || !this.projectKey) return [];
    try {
      const response = await axios.get(this.getUrl(`/projects/${this.projectKey}/statuses`));
      return response.data;
    } catch (error) {
      console.error("Error fetching statuses:", error);
      return [];
    }
  }

  async updateIssueStatus(issueKey: string, statusId: number): Promise<any> {
    if (!this.apiKey || !this.baseUrl) return null;
    try {
      const body = new URLSearchParams();
      body.append("statusId", statusId.toString());
      const response = await axios.patch(this.getUrl(`/issues/${issueKey}`), body);
      return response.data;
    } catch (error) {
      console.error(`Error updating issue status for ${issueKey}:`, error);
      throw error;
    }
  }
}
