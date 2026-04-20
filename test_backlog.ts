import dotenv from "dotenv";
import { BacklogService } from "./src/services/backlogService.ts";

dotenv.config();

async function listIssues() {
  const service = new BacklogService();
  try {
    const issues = await service.getIssues();
    console.log(JSON.stringify(issues, null, 2));
  } catch (error) {
    console.error("Failed to fetch issues:", error);
  }
}

listIssues();
