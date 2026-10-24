export type PostSummary = {
  file: string;
  title: string;
  date: string;
  date_display: string;
  author: string;
  year: string;
  preview_url: string;
  error?: string;
};

export type PostDetail = PostSummary & {
  body: string;
};

export type Draft = {
  file?: string;
  title: string;
  date: string;
  slug: string;
  author: string;
  year: string;
  body: string;
  preview_url?: string;
};

export type Bootstrap = {
  ok: boolean;
  token: string;
  siteTitle: string;
  today: string;
  previewUrl: string;
  posts: number;
};

export type PublishResult = {
  ok: boolean;
  output: string;
  posts: number;
  pages: number;
};

export type SiteConfig = {
  title: string;
  tagline: string;
  description: string;
  author: string;
  footer_motto: string;
  not_found_title: string;
  not_found_body: string;
  logo: string;
  brush_font: string;
  url: string;
  language: string;
};

export type FontOption = {
  id: string;
  label: string;
  family: string;
  css: string;
  google: boolean;
};

export type SitePayload = {
  site: SiteConfig;
  fonts: FontOption[];
};

export type ImageItem = {
  name: string;
  path: string;
  url: string;
  markdown: string;
  size: number;
  modified: number;
  is_logo: boolean;
};

export class ApiError extends Error {
  log?: string;

  constructor(message: string, log?: string) {
    super(message);
    this.name = "ApiError";
    this.log = log;
  }
}

let token = "";

export function setToken(value: string) {
  token = value;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.method && init.method !== "GET") {
    headers.set("X-Editor-Token", token);
    if (init.body) {
      headers.set("Content-Type", "application/json");
    }
  }

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch (err) {
    throw new ApiError(`无法连接编辑服务：${String(err)}`);
  }

  const data = (await response.json().catch(() => null)) as
    | (Record<string, unknown> & { error?: string; output?: string })
    | null;

  if (!response.ok || data?.ok === false) {
    const message =
      (typeof data?.error === "string" && data.error) ||
      (typeof data?.output === "string" && data.output) ||
      `请求失败（HTTP ${response.status}）`;
    throw new ApiError(message, typeof data?.output === "string" ? data.output : undefined);
  }

  return data as T;
}

export const api = {
  async bootstrap(): Promise<Bootstrap> {
    const data = await request<Bootstrap>("/api/bootstrap");
    setToken(data.token);
    return data;
  },

  async list(): Promise<PostSummary[]> {
    const data = await request<{ ok: boolean; posts: PostSummary[] }>("/api/posts");
    return data.posts;
  },

  async detail(file: string): Promise<PostDetail> {
    const data = await request<{ ok: boolean; post: PostDetail }>(
      `/api/posts/${encodeURIComponent(file)}`,
    );
    return data.post;
  },

  async create(payload: {
    title: string;
    date: string;
    slug: string;
    author: string;
    year: string;
    body: string;
  }): Promise<PostDetail> {
    const data = await request<{ ok: boolean; post: PostDetail }>("/api/posts", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return data.post;
  },

  async update(
    file: string,
    payload: { title: string; author: string; year: string; body: string },
  ): Promise<PostDetail> {
    const data = await request<{ ok: boolean; post: PostDetail }>(
      `/api/posts/${encodeURIComponent(file)}`,
      { method: "PUT", body: JSON.stringify(payload) },
    );
    return data.post;
  },

  async remove(file: string): Promise<void> {
    await request<{ ok: boolean }>(`/api/posts/${encodeURIComponent(file)}`, {
      method: "DELETE",
    });
  },

  async publish(): Promise<PublishResult> {
    return request<PublishResult>("/api/publish", {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  async site(): Promise<SitePayload> {
    return request<{ ok: boolean; site: SiteConfig; fonts: FontOption[] }>("/api/site");
  },

  async updateSite(site: SiteConfig): Promise<SitePayload> {
    return request<{ ok: boolean; site: SiteConfig; fonts: FontOption[] }>("/api/site", {
      method: "PUT",
      body: JSON.stringify(site),
    });
  },

  async setLogo(logo: string): Promise<SiteConfig> {
    const data = await request<{ ok: boolean; site: SiteConfig }>("/api/site/logo", {
      method: "POST",
      body: JSON.stringify({ logo }),
    });
    return data.site;
  },

  async images(): Promise<{ images: ImageItem[]; logo: string }> {
    return request<{ ok: boolean; images: ImageItem[]; logo: string }>("/api/images");
  },

  async uploadImage(file: File): Promise<ImageItem> {
    const form = new FormData();
    form.append("file", file);
    let response: Response;
    try {
      response = await fetch("/api/images", {
        method: "POST",
        headers: { "X-Editor-Token": token },
        body: form,
      });
    } catch (err) {
      throw new ApiError(`图片上传失败：${String(err)}`);
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      throw new ApiError(
        (typeof data?.error === "string" && data.error) ||
          `图片上传失败（HTTP ${response.status}）`,
      );
    }
    return data.image as ImageItem;
  },

  async removeImage(name: string): Promise<void> {
    await request<{ ok: boolean }>(`/api/images/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  },
};
