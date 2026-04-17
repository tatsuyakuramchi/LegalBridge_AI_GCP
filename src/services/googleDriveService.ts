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
      });

      return response.data.webViewLink || "";
    } catch (error) {
      console.error("Error uploading to Google Drive:", error);
      throw error;
    }
  }
}
