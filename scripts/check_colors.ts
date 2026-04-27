import axios from 'axios';
const API_KEY = process.env.BACKLOG_API_KEY || '';
const HOST = (process.env.BACKLOG_HOST || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const PROJECT_KEY = process.env.BACKLOG_PROJECT_KEY || '';
const BASE_URL = `https://${HOST}/api/v2`;
const getUrl = (path: string) => `${BASE_URL}${path}?apiKey=${API_KEY}`;
async function check() {
  const res = await axios.get(getUrl(`/projects/${PROJECT_KEY}/issueTypes`));
  console.log(JSON.stringify(res.data, null, 2));
}
check();
