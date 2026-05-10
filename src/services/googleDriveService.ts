import { google } from "googleapis";
import { Readable } from "stream";

export class GoogleDriveService {
  private drive;

  constructor() {
    this.drive = google.drive({
      version: "v3",
      auth: new google.auth.GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/drive.file"],
      })
    });
  }

  async uploadHtml(html: string, fileName: string, folderId?: string): Promise<string> {
    // Cloud Run環境（ADC）または環境変数を自動認識します
    const folder = folderId || process.env.GOOGLE_DRIVE_FOLDER_ID;

    const fileMetadata = {
      name: fileName,
      parents: folder ? [folder] : [],
      mimeType: "application/vnd.google-apps.document", // Automatically convert to Google Doc
    };

    const media = {
      mimeType: "text/html",
      body: Readable.from([html]),
    };

    try {
      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: "id, webViewLink",
        // Required when GOOGLE_DRIVE_FOLDER_ID points at a folder inside a
        // Shared Drive. Service accounts have zero personal-Drive quota,
        // so writing to "My Drive" always 403s with
        // `The user's Drive storage quota has been exceeded.` Setting
        // supportsAllDrives + a Shared-Drive folder id sidesteps that.
        supportsAllDrives: true,
      });

      return response.data.webViewLink || "";
    } catch (error) {
      console.error("Error uploading to Google Drive:", error);
      throw error;
    }
  }

  async uploadMarkdown(markdown: string, fileName: string, folderId?: string): Promise<string> {
    // Cloud Run環境（ADC）または環境変数を自動認識します
    const folder = folderId || process.env.GOOGLE_DRIVE_FOLDER_ID;

    const fileMetadata = {
      name: fileName.replace(/\.html$/, ""),
      parents: folder ? [folder] : [],
      mimeType: "application/vnd.google-apps.document", // Automatically convert to Google Doc
    };

    const media = {
      mimeType: "text/markdown",
      body: Readable.from([markdown]),
    };

    try {
      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: "id, webViewLink",
        supportsAllDrives: true,
      });

      return response.data.webViewLink || "";
    } catch (error) {
      console.error("Error uploading Markdown to Google Drive:", error);
      throw error;
    }
  }

  async uploadFile(stream: Readable, fileName: string, mimeType: string, folderId?: string): Promise<string> {
    const folder = folderId || process.env.GOOGLE_DRIVE_FOLDER_ID;

    const fileMetadata = {
      name: fileName,
      parents: folder ? [folder] : [],
    };

    const media = {
      mimeType: mimeType,
      body: stream,
    };

    try {
      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: "id, webViewLink",
        supportsAllDrives: true,
      });

      return response.data.webViewLink || "";
    } catch (error) {
      console.error("Error uploading file to Google Drive:", error);
      throw error;
    }
  }
}

