const fetch = require('node-fetch');
require('dotenv').config();

(async () => {
  const { Octokit } = await import('@octokit/rest');

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const TARGET_REPO = 'shipwr3ckd/revengeplugin';
  const pluginList = 'https://raw.githubusercontent.com/shipwr3ckd/revengeplugin/master/plugins-data/plugins.json';
  const Index = 'https://raw.githubusercontent.com/Purple-EyeZ/Plugins-List/main/src/plugins-data.json';

  const [owner, repo] = TARGET_REPO.split('/');
  const octokit = new Octokit({ auth: GITHUB_TOKEN });

  async function fetchIndex() {
    const resp = await fetch(Index);
    if (!resp.ok) throw new Error('Failed to fetch Index: ' + resp.status);
    const plugins = await resp.json();

    const urlInfoMap = new Map();
    plugins.forEach(p => {
      if (p.installUrl) {
        const url = p.installUrl.replace(/^https?:\/\//, '');
        const status = (p.status || 'unknown').toLowerCase();
        const warningMessage = p.warningMessage || null;
        urlInfoMap.set(url, { status, warningMessage });
      }
    });

    return urlInfoMap;
  }

  async function fetchPluginManifests(urlInfoMap) {
    const manifests = await Promise.all([...urlInfoMap.entries()].map(async ([pluginUrl, { status, warningMessage }]) => {
      try {
        const url = pluginUrl.endsWith('/') ? pluginUrl : pluginUrl + '/';
        const manifestURL = `https://${url}manifest.json`;

        const manifestResp = await fetch(manifestURL);
        if (!manifestResp.ok) return null;

        const manifest = await manifestResp.json();
        manifest.vendetta = manifest.vendetta || {};
        manifest.vendetta.original = url;

        if (status === 'broken') {
          manifest.bunny = { broken: true };
        } else if (status === 'warning') {
          manifest.bunny = { warning: true };
        }

        if ((status === 'broken' || status === 'warning') && warningMessage) {
          const warningFormatted = `\n\n⚠️ ${warningMessage} ⚠️`;
          manifest.description = (manifest.description || '') + warningFormatted;
        }

        return manifest;
      } catch {
        return null;
      }
    }));

    return manifests.filter(Boolean);
  }

  async function getFileContent(path) {
    try {
      const { data } = await octokit.repos.getContent({ owner, repo, path });
      const buff = Buffer.from(data.content, 'base64');
      return buff.toString();
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  async function createOrUpdateFile(path, content, message) {
    const existing = await getFileContent(path);
    const encodedContent = Buffer.from(content).toString('base64');

    if (existing && Buffer.from(existing).toString('base64') === encodedContent) {
      console.log(`🟡 No changes to ${path}, skipping commit.`);
      return false;
    }

    const params = {
      owner,
      repo,
      path,
      message,
      content: encodedContent,
      committer: {
        name: 'Plugins update',
        email: 'auto@bot.com'
      },
      author: {
        name: 'Auto Committer',
        email: 'auto@bot.com'
      }
    };

    if (existing) {
      const { data } = await octokit.repos.getContent({ owner, repo, path });
      params.sha = data.sha;
    }

    await octokit.repos.createOrUpdateFileContents(params);
    console.log(`✅ Committed ${path}`);
    return true;
  }

  try {
    const urlStatusMap = await fetchIndex();
    const installUrls = [...urlStatusMap.keys()];
    const pluginsJson = JSON.stringify(installUrls, null, 2);

    const pluginsJsonUpdated = await createOrUpdateFile(
      'plugins-data/plugins.json',
      pluginsJson,
      'Update plugins.json'
    );

    if (pluginsJsonUpdated) {
      const manifests = await fetchPluginManifests(urlStatusMap);
      const fullJson = JSON.stringify(manifests, null, 2);

      await createOrUpdateFile(
        'plugins-data/plugins-full.json',
        fullJson,
        'Update plugins-full.json'
      );
    }

  } catch (err) {
    console.error('❌ Update failed:', err.message);
    process.exit(1);
  }
})();