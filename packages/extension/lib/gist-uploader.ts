/**
 * GitHub Gist 上传 —— 用 PAT (personal access token)
 * token 存 chrome.storage.local
 */

const TOKEN_KEY = "site2source:githubToken";

export async function getGithubToken(): Promise<string> {
  const r = await chrome.storage.local.get([TOKEN_KEY]);
  return r[TOKEN_KEY] || "";
}

export async function setGithubToken(token: string) {
  await chrome.storage.local.set({ [TOKEN_KEY]: token });
}

export interface GistUploadResult {
  ok: boolean;
  spiderURL?: string; // raw URL of spider
  gistURL?: string; // html url of gist
  error?: string;
}

/** 上传 spider + tvbox 到一个 Gist */
export async function uploadToGist(
  siteName: string,
  host: string,
  spider: string,
  tvbox: string
): Promise<GistUploadResult> {
  const token = await getGithubToken();
  if (!token) {
    return { ok: false, error: "未配置 GitHub token（点右上齿轮设置）" };
  }

  const spiderFile = `spider_${host.replace(/[.:]/g, "_")}.js`;
  const tvboxFile = `tvbox.json`;

  // 先创建 Gist（含 spider）
  const body = {
    description: `TVBox source for ${siteName} · site2source`,
    public: false,
    files: {
      [spiderFile]: { content: spider },
      [tvboxFile]: { content: "PLACEHOLDER" }, // 等有 raw URL 再更新
    },
  };

  let res: Response;
  try {
    res = await fetch("https://api.github.com/gists", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: "网络错误：" + (e as Error).message };
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return { ok: false, error: `GitHub API 错误 ${res.status}: ${txt.slice(0, 200)}` };
  }

  const gist: any = await res.json();
  const gistId = gist.id;
  const gistHtmlURL = gist.html_url;
  const spiderRaw = gist.files?.[spiderFile]?.raw_url as string | undefined;

  if (!spiderRaw) {
    return { ok: false, error: "创建成功但没拿到 raw URL" };
  }

  // 用真实 spiderRaw 替换 tvbox 里的 placeholder（如果有的话）
  const tvboxFinal = tvbox.replace(/"api":\s*"[^"]*"/, `"api": "${spiderRaw}"`);

  // 更新 gist 里的 tvbox 内容
  try {
    await fetch(`https://api.github.com/gists/${gistId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        files: { [tvboxFile]: { content: tvboxFinal } },
      }),
    });
  } catch (e) {
    // 非致命，只是 tvbox api 字段没更新
  }

  return {
    ok: true,
    spiderURL: spiderRaw,
    gistURL: gistHtmlURL,
  };
}
