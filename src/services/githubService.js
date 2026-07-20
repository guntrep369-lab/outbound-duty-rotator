/**
 * @file githubService.js — thin wrapper over the GitHub REST API (Octokit) that
 * treats a repository as a JSON database. Handles UTF-8 (Thai) content, missing
 * files (first-time write), and optimistic-concurrency SHAs.
 */

import { Octokit } from '@octokit/rest';

/** Encode a JS string as base64 while preserving multi-byte UTF-8 (Thai) chars. */
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Decode base64 (as returned by the Contents API) back into a UTF-8 string. */
function base64ToUtf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export class GitHubService {
  /** @param {{token:string, owner:string, repo:string, branch?:string, dir?:string}} cfg */
  constructor(cfg) {
    this.owner = cfg.owner;
    this.repo = cfg.repo;
    this.branch = cfg.branch || 'main';
    this.dir = (cfg.dir || 'data').replace(/^\/+|\/+$/g, '');
    this.octokit = new Octokit({ auth: cfg.token });
  }

  /** Full path of a data file inside the repo. */
  path(name) {
    return this.dir ? `${this.dir}/${name}` : name;
  }

  /**
   * Verify the token can reach the repo and report write permission.
   * @returns {Promise<{ok:true, fullName:string, canWrite:boolean, defaultBranch:string}>}
   */
  async testConnection() {
    const { data } = await this.octokit.repos.get({ owner: this.owner, repo: this.repo });
    return {
      ok: true,
      fullName: data.full_name,
      canWrite: !!(data.permissions && (data.permissions.push || data.permissions.admin)),
      defaultBranch: data.default_branch,
      private: data.private,
    };
  }

  /**
   * Read + parse a JSON file. Returns { data:null, sha:null } if it doesn't exist yet.
   * @param {string} name  e.g. "employees.json"
   * @returns {Promise<{data:any, sha:string|null}>}
   */
  async getJson(name) {
    try {
      const res = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path: this.path(name),
        ref: this.branch,
        // Avoid any HTTP caching of the contents API.
        headers: { 'If-None-Match': '' },
      });
      const file = res.data;
      if (Array.isArray(file) || file.type !== 'file') {
        throw new Error(`${name} is not a file`);
      }
      const text = base64ToUtf8(file.content);
      return { data: text.trim() ? JSON.parse(text) : null, sha: file.sha };
    } catch (err) {
      if (err.status === 404) return { data: null, sha: null };
      throw err;
    }
  }

  /**
   * Create or update a JSON file. Pass the current sha for updates (null to create).
   * @returns {Promise<{sha:string}>} the new blob sha
   */
  async putJson(name, data, sha, message) {
    const content = utf8ToBase64(`${JSON.stringify(data, null, 2)}\n`);
    const res = await this.octokit.repos.createOrUpdateFileContents({
      owner: this.owner,
      repo: this.repo,
      path: this.path(name),
      message: message || `chore(data): update ${name}`,
      content,
      branch: this.branch,
      ...(sha ? { sha } : {}),
    });
    return { sha: res.data.content.sha };
  }
}

/** Turn an Octokit/network error into a friendly message. */
export function describeGitHubError(err) {
  if (!err) return 'Unknown error';
  const status = err.status;
  if (status === 401) return 'Invalid or expired token (401). Check your Personal Access Token.';
  if (status === 403) return 'Access forbidden (403). The token may lack "repo"/"contents" scope, or you hit a rate limit.';
  if (status === 404) return 'Repository not found (404). Check the owner and repo name, and that the token can see it.';
  if (status === 409) return 'Conflict (409). The file changed on GitHub since it was loaded — reload and retry.';
  if (status === 422) return 'Unprocessable (422). The branch may not exist yet.';
  return err.message || String(err);
}
