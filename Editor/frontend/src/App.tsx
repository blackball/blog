import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  ApiError,
  api,
  type Draft,
  type FontOption,
  type ImageItem,
  type PostDetail,
  type PostSummary,
  type SiteConfig,
} from "./api";

type View = "articles" | "site" | "images";
type Mode = "none" | "new" | "edit";
type StatusKind = "idle" | "working" | "ok" | "error";

type Status = {
  kind: StatusKind;
  text: string;
  log?: string;
};

function slugFromFile(file: string): string {
  const match = file.match(/^\d{4,5}-\d{2}-\d{2}-(.+)\.md$/);
  return match ? match[1] : file.replace(/\.md$/, "");
}

function toDraft(post: PostDetail): Draft {
  return {
    file: post.file,
    title: post.title,
    date: post.date,
    slug: slugFromFile(post.file),
    author: post.author,
    year: post.year,
    body: post.body,
    preview_url: post.preview_url,
  };
}

function newDraft(today: string): Draft {
  return {
    title: "",
    date: today,
    slug: "",
    author: "",
    year: "",
    body: "",
  };
}

function errorMessage(err: unknown): ApiError {
  if (err instanceof ApiError) {
    return err;
  }
  return new ApiError(err instanceof Error ? err.message : String(err));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="m12.6 12.6 4 4" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 4v12M4 10h12" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="3" y="4" width="14" height="12" rx="1.5" />
      <circle cx="7.2" cy="8.2" r="1.2" />
      <path d="m4.5 14 4-4 3 3 2-2 2 3" />
    </svg>
  );
}

export default function App() {
  const [siteTitle, setSiteTitle] = useState("blackball");
  const [today, setToday] = useState(new Date().toISOString().slice(0, 10));
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [mode, setMode] = useState<Mode>("none");
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [dirty, setDirty] = useState(false);
  const [siteDirty, setSiteDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [siteBusy, setSiteBusy] = useState(false);
  const [imagesBusy, setImagesBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle", text: "" });
  const [view, setView] = useState<View>("articles");
  const [siteDraft, setSiteDraft] = useState<SiteConfig | null>(null);
  const [fonts, setFonts] = useState<FontOption[]>([]);
  const [images, setImages] = useState<ImageItem[]>([]);

  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const publishRef = useRef<() => void>(() => {});
  const bodyImageRef = useRef<HTMLInputElement>(null);
  const libraryImageRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const bootstrap = await api.bootstrap();
        if (!active) return;
        setSiteTitle(bootstrap.siteTitle);
        setToday(bootstrap.today);
        const [sitePayload, list] = await Promise.all([api.site(), api.list()]);
        if (!active) return;
        setSiteDraft(sitePayload.site);
        setFonts(sitePayload.fonts);
        setSiteTitle(sitePayload.site.title);
        setPosts(list);
        setReady(true);
      } catch (err) {
        if (!active) return;
        setLoadError(errorMessage(err).message);
        setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const filteredPosts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return posts;
    return posts.filter((post) =>
      [post.title, post.date_display, post.author, post.year]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [posts, query]);

  const characterCount = draft ? draft.body.replace(/\s/g, "").length : 0;
  const lineCount = draft ? draft.body.split("\n").length : 0;
  const currentDirty = view === "site" ? siteDirty : view === "articles" ? dirty : false;
  const anyBusy = busy || siteBusy || imagesBusy;

  function confirmDiscard(): boolean {
    return !dirty || window.confirm("当前文章还没有发布，确定放弃修改吗？");
  }

  async function refreshPosts() {
    const list = await api.list();
    setPosts(list);
  }

  async function selectPost(post: PostSummary) {
    if (!confirmDiscard()) return;
    if (post.error) {
      setStatus({ kind: "error", text: post.error });
      return;
    }
    setBusy(true);
    setStatus({ kind: "idle", text: "" });
    try {
      const detail = await api.detail(post.file);
      setDraft(toDraft(detail));
      setMode("edit");
      setSelected(post.file);
      setDirty(false);
      setView("articles");
      workspaceRef.current?.scrollTo({ top: 0 });
    } catch (err) {
      setStatus({ kind: "error", text: errorMessage(err).message });
    } finally {
      setBusy(false);
    }
  }

  function createNew() {
    if (!confirmDiscard()) return;
    setDraft(newDraft(today));
    setMode("new");
    setSelected(null);
    setDirty(false);
    setStatus({ kind: "idle", text: "" });
    setView("articles");
    workspaceRef.current?.scrollTo({ top: 0 });
    window.setTimeout(() => titleRef.current?.focus(), 30);
  }

  function change<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setDirty(true);
    if (status.kind !== "working") {
      setStatus({ kind: "idle", text: "" });
    }
  }

  function changeSite<K extends keyof SiteConfig>(key: K, value: SiteConfig[K]) {
    setSiteDraft((current) => (current ? { ...current, [key]: value } : current));
    setSiteDirty(true);
    if (status.kind !== "working") {
      setStatus({ kind: "idle", text: "" });
    }
  }

  async function publish() {
    if (!draft || busy) return;
    if (!draft.title.trim()) {
      setStatus({ kind: "error", text: "请先写一个标题。" });
      titleRef.current?.focus();
      return;
    }

    setBusy(true);
    setStatus({ kind: "working", text: "正在写入 Markdown 并生成页面……" });
    let saved = false;
    let savedFile = draft.file;

    try {
      if (mode === "new") {
        const post = await api.create({
          title: draft.title,
          date: draft.date,
          slug: draft.slug,
          author: draft.author,
          year: draft.year,
          body: draft.body,
        });
        saved = true;
        savedFile = post.file;
        setDraft(toDraft(post));
        setMode("edit");
        setSelected(post.file);
        setDirty(false);
      } else if (draft.file) {
        const post = await api.update(draft.file, {
          title: draft.title,
          author: draft.author,
          year: draft.year,
          body: draft.body,
        });
        saved = true;
        savedFile = post.file;
        setDraft(toDraft(post));
        setDirty(false);
      } else {
        throw new ApiError("缺少文章文件名。");
      }

      const result = await api.publish();
      await refreshPosts();
      setStatus({
        kind: "ok",
        text: `已生成 ${result.posts} 篇文章、${result.pages} 个页面。下一步：git push。`,
        log: result.output,
      });
    } catch (err) {
      const error = errorMessage(err);
      if (saved && savedFile) {
        try {
          await refreshPosts();
          setSelected(savedFile);
        } catch {
          // The source is already saved; keep the error visible.
        }
      }
      setStatus({
        kind: "error",
        text: saved ? "生成失败，Markdown 已保存。" : error.message,
        log: error.log ?? error.message,
      });
    } finally {
      setBusy(false);
    }
  }

  async function saveSite() {
    if (!siteDraft || siteBusy) return;
    setSiteBusy(true);
    setStatus({ kind: "working", text: "正在保存站点设置并生成页面……" });
    let saved = false;
    try {
      const updated = await api.updateSite(siteDraft);
      saved = true;
      setSiteDraft(updated.site);
      setFonts(updated.fonts);
      setSiteTitle(updated.site.title);
      setSiteDirty(false);
      const result = await api.publish();
      await loadImages();
      setStatus({
        kind: "ok",
        text: `站点设置已保存，已生成 ${result.posts} 篇文章、${result.pages} 个页面。下一步：git push。`,
        log: result.output,
      });
    } catch (err) {
      const error = errorMessage(err);
      setStatus({
        kind: "error",
        text: saved ? "生成失败，站点设置已保存。" : error.message,
        log: error.log ?? error.message,
      });
    } finally {
      setSiteBusy(false);
    }
  }

  publishRef.current = view === "articles" ? publish : view === "site" ? saveSite : () => {};

  async function removePost() {
    if (!draft?.file || busy) return;
    if (
      !window.confirm(
        `确定删除《${draft.title}》吗？\n\n会删除 Markdown 并重新生成站点。`,
      )
    ) {
      return;
    }

    setBusy(true);
    setStatus({ kind: "working", text: "正在删除并重新生成……" });
    let removed = false;
    try {
      await api.remove(draft.file);
      removed = true;
      const result = await api.publish();
      await refreshPosts();
      setDraft(null);
      setMode("none");
      setSelected(null);
      setDirty(false);
      setStatus({
        kind: "ok",
        text: "文章已删除，站点已生成。下一步：git push。",
        log: result.output,
      });
    } catch (err) {
      const error = errorMessage(err);
      if (removed) {
        try {
          await refreshPosts();
          setDraft(null);
          setMode("none");
          setSelected(null);
          setDirty(false);
        } catch {
          // The source is already removed; keep the error visible.
        }
      }
      setStatus({
        kind: "error",
        text: removed ? "文章已删除，但生成失败。" : error.message,
        log: error.log ?? error.message,
      });
    } finally {
      setBusy(false);
    }
  }

  async function loadImages() {
    try {
      const result = await api.images();
      setImages(result.images);
    } catch (err) {
      setStatus({ kind: "error", text: errorMessage(err).message });
    }
  }

  async function switchView(next: View) {
    setView(next);
    if (next === "images") {
      await loadImages();
    }
  }

  function insertMarkdown(markdown: string, atCursor: boolean) {
    if (!draft) {
      setStatus({ kind: "error", text: "先打开或新建一篇文章，再插入图片。" });
      return;
    }
    if (atCursor && bodyRef.current) {
      const textarea = bodyRef.current;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const before = draft.body.slice(0, start);
      const after = draft.body.slice(end);
      const prefix = before && !before.endsWith("\n") ? "\n\n" : "";
      const suffix = after && !after.startsWith("\n") ? "\n\n" : "\n";
      const insertion = `${prefix}${markdown}${suffix}`;
      change("body", before + insertion + after);
      window.setTimeout(() => {
        const position = start + insertion.length;
        textarea.focus();
        textarea.setSelectionRange(position, position);
      }, 0);
    } else {
      const next = draft.body.trim()
        ? `${draft.body.replace(/\s+$/, "")}\n\n${markdown}\n`
        : `${markdown}\n`;
      change("body", next);
    }
    setView("articles");
  }

  async function uploadImage(file: File, insertAtCursor: boolean) {
    setImagesBusy(true);
    setStatus({ kind: "working", text: "正在上传图片……" });
    try {
      const image = await api.uploadImage(file);
      await loadImages();
      if (insertAtCursor) {
        insertMarkdown(image.markdown, true);
        setStatus({ kind: "ok", text: "图片已上传并插入正文，发布会写入站点。" });
      } else {
        setStatus({ kind: "ok", text: `图片已上传：${image.name}` });
      }
    } catch (err) {
      setStatus({ kind: "error", text: errorMessage(err).message });
    } finally {
      setImagesBusy(false);
    }
  }

  async function setAsLogo(image: ImageItem) {
    if (imagesBusy) return;
    setImagesBusy(true);
    setStatus({ kind: "working", text: "正在更换站点 logo 并生成页面……" });
    let saved = false;
    try {
      const updated = await api.setLogo(image.path);
      saved = true;
      setSiteDraft(updated);
      setSiteDirty(false);
      const result = await api.publish();
      await loadImages();
      setStatus({
        kind: "ok",
        text: `站点 logo 已更换为 ${image.name}，下一步：git push。`,
        log: result.output,
      });
    } catch (err) {
      const error = errorMessage(err);
      setStatus({
        kind: "error",
        text: saved ? "生成失败，logo 设置已保存。" : error.message,
        log: error.log ?? error.message,
      });
    } finally {
      setImagesBusy(false);
    }
  }

  async function removeImage(image: ImageItem) {
    if (imagesBusy) return;
    if (!window.confirm(`确定删除图片 ${image.name} 吗？`)) return;
    setImagesBusy(true);
    setStatus({ kind: "working", text: "正在删除图片……" });
    try {
      await api.removeImage(image.name);
      await loadImages();
      setStatus({ kind: "ok", text: `已删除图片 ${image.name}。` });
    } catch (err) {
      setStatus({ kind: "error", text: errorMessage(err).message });
    } finally {
      setImagesBusy(false);
    }
  }

  async function copyImageMarkdown(image: ImageItem) {
    try {
      await copyText(image.markdown);
      setStatus({ kind: "ok", text: "图片 Markdown 已复制到剪贴板。" });
    } catch (err) {
      setStatus({ kind: "error", text: errorMessage(err).message });
    }
  }

  function handleBodyImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void uploadImage(file, true);
  }

  function handleLibraryImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void uploadImage(file, false);
  }

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty && !siteDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, siteDirty]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        publishRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!ready) {
    return (
      <div className="loading-screen">
        <span className="loading-seal">墨</span>
        <p>正在打开编辑室……</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="fatal-screen">
        <h1>无法打开编辑室</h1>
        <p>{loadError}</p>
        <button className="primary-btn" type="button" onClick={() => window.location.reload()}>
          重新连接
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-seal" aria-hidden="true">墨</span>
          <span className="brand-name">{siteTitle}</span>
          <span className="brand-sub">编辑室</span>
        </div>

        <nav className="view-tabs" aria-label="编辑区域">
          <button
            type="button"
            className={`view-tab ${view === "articles" ? "is-active" : ""}`}
            onClick={() => void switchView("articles")}
          >
            文章
          </button>
          <button
            type="button"
            className={`view-tab ${view === "site" ? "is-active" : ""}`}
            onClick={() => void switchView("site")}
          >
            站点
          </button>
          <button
            type="button"
            className={`view-tab ${view === "images" ? "is-active" : ""}`}
            onClick={() => void switchView("images")}
          >
            图片
          </button>
        </nav>

        <div className="top-actions">
          {view !== "images" && (
            <span className={`sync-state ${currentDirty ? "is-dirty" : ""}`}>
              <span className="sync-dot" aria-hidden="true" />
              {anyBusy ? "处理中" : currentDirty ? "未发布" : "本地已同步"}
            </span>
          )}
          <a className="ghost-btn" href="/preview/" target="_blank" rel="noreferrer">
            预览站点 <span aria-hidden="true">↗</span>
          </a>
          {view === "articles" && (
            <button
              className="primary-btn"
              type="button"
              onClick={publish}
              disabled={!draft || busy}
            >
              {busy ? "生成中……" : "发布"}
            </button>
          )}
          {view === "site" && (
            <button
              className="primary-btn"
              type="button"
              onClick={saveSite}
              disabled={!siteDraft || siteBusy}
            >
              {siteBusy ? "生成中……" : "保存并发布"}
            </button>
          )}
          {view === "images" && (
            <button
              className="primary-btn"
              type="button"
              onClick={() => libraryImageRef.current?.click()}
              disabled={imagesBusy}
            >
              {imagesBusy ? "处理中……" : "上传图片"}
            </button>
          )}
        </div>
      </header>

      {view === "articles" && (
        <div className="editor-layout">
          <aside className="sidebar">
            <div className="sidebar-head">
              <div>
                <p className="section-kicker">Manuscripts</p>
                <p className="sidebar-title">文章</p>
              </div>
              <button className="new-btn" type="button" onClick={createNew}>
                <PlusIcon />
                新建
              </button>
            </div>

            <label className="search-box">
              <SearchIcon />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索标题、日期、作者"
                aria-label="搜索文章"
              />
            </label>

            <div className="post-list" aria-label="文章列表">
              {filteredPosts.length === 0 ? (
                <p className="list-empty">
                  {posts.length === 0 ? "还没有文章。" : "没有匹配的文章。"}
                </p>
              ) : (
                filteredPosts.map((post) => (
                  <button
                    key={post.file}
                    type="button"
                    className={`post-item ${selected === post.file ? "is-active" : ""}`}
                    onClick={() => void selectPost(post)}
                  >
                    <span className="post-item-date">{post.date_display || "未命名"}</span>
                    <span className="post-item-main">
                      <span className="post-item-title">{post.title}</span>
                      {post.error && <span className="post-item-error">文件需要修正</span>}
                    </span>
                  </button>
                ))
              )}
            </div>

            <div className="sidebar-foot">
              <span>{filteredPosts.length} / {posts.length} 篇</span>
              <span>发布后请 git push</span>
            </div>
          </aside>

          <main className="workspace" ref={workspaceRef}>
            {!draft ? (
              <div className="empty-state">
                <span className="empty-seal" aria-hidden="true">墨</span>
                <p className="section-kicker">Local writing desk</p>
                <h1>选择一篇文章</h1>
                <p className="empty-copy">
                  从左侧选择要修改的文章，或者新建一篇文章。
                  <br />
                  发布只会写入本地文件，之后由你决定何时 git push。
                </p>
                <button className="primary-btn" type="button" onClick={createNew}>
                  新建一篇文章
                </button>
              </div>
            ) : (
              <article className="manuscript">
                <header className="manuscript-head">
                  <p className="section-kicker">
                    {mode === "new" ? "New manuscript" : "Editing manuscript"}
                  </p>
                  <input
                    ref={titleRef}
                    className="title-input"
                    value={draft.title}
                    onChange={(event) => change("title", event.target.value)}
                    placeholder="文章标题"
                    aria-label="文章标题"
                    spellCheck={false}
                  />

                  <div className="meta-grid">
                    <label className="field">
                      <span>日期</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="\d{4}-\d{2}-\d{2}"
                        maxLength={10}
                        value={draft.date}
                        onChange={(event) => change("date", event.target.value)}
                        placeholder="YYYY-MM-DD"
                        disabled={mode === "edit"}
                        spellCheck={false}
                      />
                    </label>
                    <label className="field">
                      <span>URL / 文件名</span>
                      <input
                        value={draft.slug}
                        onChange={(event) => change("slug", event.target.value)}
                        placeholder="留空自动生成"
                        disabled={mode === "edit"}
                        spellCheck={false}
                      />
                    </label>
                    <label className="field">
                      <span>作者</span>
                      <input
                        value={draft.author}
                        onChange={(event) => change("author", event.target.value)}
                        placeholder="可选"
                        spellCheck={false}
                      />
                    </label>
                    <label className="field">
                      <span>年份</span>
                      <input
                        value={draft.year}
                        onChange={(event) => change("year", event.target.value)}
                        placeholder="可选"
                        spellCheck={false}
                      />
                    </label>
                  </div>
                  {mode === "edit" && (
                    <p className="field-note">日期和 URL 由文件名决定，修改它们会改变文章地址。</p>
                  )}
                </header>

                <section className="body-block">
                  <div className="body-head">
                    <label htmlFor="body-editor">正文 / Markdown</label>
                    <div className="body-tools">
                      <span>{characterCount} 字 · {lineCount} 行</span>
                      <button
                        className="inline-action"
                        type="button"
                        onClick={() => bodyImageRef.current?.click()}
                        disabled={imagesBusy}
                      >
                        <ImageIcon />
                        插入图片
                      </button>
                    </div>
                  </div>
                  <textarea
                    ref={bodyRef}
                    id="body-editor"
                    className="body-input"
                    value={draft.body}
                    onChange={(event) => change("body", event.target.value)}
                    placeholder={"从这里开始写。\n\n可以用 ## 写小节，空行分段。"}
                    spellCheck={false}
                  />
                </section>

                <footer className="editor-foot">
                  <span className="file-label" title={draft.file}>
                    {draft.file ? `posts/${draft.file}` : "尚未创建本地文件"}
                  </span>
                  <div className="foot-actions">
                    {draft.preview_url && (
                      <a
                        className="text-link"
                        href={draft.preview_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看文章 <span aria-hidden="true">↗</span>
                      </a>
                    )}
                    {mode === "edit" && (
                      <button
                        className="danger-btn"
                        type="button"
                        onClick={removePost}
                        disabled={busy}
                      >
                        删除文章
                      </button>
                    )}
                  </div>
                </footer>
              </article>
            )}
          </main>
        </div>
      )}

      {view === "site" && (
        <main className="workspace single-workspace">
          {siteDraft ? (
            <section className="settings-page">
              <header className="page-head">
                <div>
                  <p className="section-kicker">Site settings</p>
                  <h1>站点文字</h1>
                  <p className="page-copy">
                    修改站名、标语、简介、页脚和 404 文案。保存后会重新生成整个站点。
                  </p>
                </div>
              </header>

              <div className="settings-grid">
                <label className="field">
                  <span>站点标题</span>
                  <input
                    value={siteDraft.title}
                    onChange={(event) => changeSite("title", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>标语</span>
                  <input
                    value={siteDraft.tagline}
                    onChange={(event) => changeSite("tagline", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>作者</span>
                  <input
                    value={siteDraft.author}
                    onChange={(event) => changeSite("author", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>页脚箴言</span>
                  <input
                    value={siteDraft.footer_motto}
                    onChange={(event) => changeSite("footer_motto", event.target.value)}
                  />
                </label>
                <label className="field field-wide">
                  <span>站点简介</span>
                  <textarea
                    rows={3}
                    value={siteDraft.description}
                    onChange={(event) => changeSite("description", event.target.value)}
                  />
                </label>
                <label className="field field-wide">
                  <span>404 标题</span>
                  <input
                    value={siteDraft.not_found_title}
                    onChange={(event) => changeSite("not_found_title", event.target.value)}
                  />
                </label>
                <label className="field field-wide">
                  <span>404 文案</span>
                  <textarea
                    rows={2}
                    value={siteDraft.not_found_body}
                    onChange={(event) => changeSite("not_found_body", event.target.value)}
                  />
                </label>
              </div>

              <div className="font-picker">
                <div className="font-picker-head">
                  <div>
                    <p className="section-kicker">Typeface</p>
                    <h2>毛笔字体</h2>
                  </div>
                  <p>全站标语与文章标题统一使用，保存并发布后生效。</p>
                </div>
                <div className="font-options">
                  {fonts.map((font) => (
                    <button
                      key={font.id}
                      type="button"
                      className={`font-option ${siteDraft.brush_font === font.id ? "is-active" : ""}`}
                      aria-pressed={siteDraft.brush_font === font.id}
                      onClick={() => changeSite("brush_font", font.id)}
                    >
                      <span className="font-option-sample" style={{ fontFamily: font.css }}>
                        {siteDraft.tagline || siteDraft.title || "辉之志"}
                      </span>
                      <span className="font-option-label">{font.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-logo">
                <div className="settings-logo-image">
                  {siteDraft.logo ? (
                    <img src={`/preview/${siteDraft.logo}`} alt="" />
                  ) : (
                    <span className="logo-empty">墨</span>
                  )}
                </div>
                <div className="settings-logo-copy">
                  <p>站点印记</p>
                  <span>{siteDraft.logo || "未设置"}</span>
                </div>
                <button
                  className="ghost-btn"
                  type="button"
                  onClick={() => void switchView("images")}
                >
                  去图片库更换
                </button>
              </div>

              <footer className="settings-foot">
                <span>发布只会更新本地文件，之后请 git push。</span>
                <button
                  className="primary-btn"
                  type="button"
                  onClick={saveSite}
                  disabled={siteBusy}
                >
                  {siteBusy ? "生成中……" : "保存并发布"}
                </button>
              </footer>
            </section>
          ) : (
            <p className="page-loading">正在读取站点设置……</p>
          )}
        </main>
      )}

      {view === "images" && (
        <main className="workspace single-workspace">
          <section className="images-page">
            <header className="page-head images-head">
              <div>
                <p className="section-kicker">Image library</p>
                <h1>图片</h1>
                <p className="page-copy">
                  上传文章插图或站点印记，单张不超过 8 MB。插入正文时使用
                  <code>../imgs/</code> 路径；设为 logo 会更新全站。
                </p>
              </div>
            </header>

            {images.length === 0 ? (
              <div className="image-empty">
                <p>图片库还是空的。</p>
                <button
                  className="primary-btn"
                  type="button"
                  onClick={() => libraryImageRef.current?.click()}
                >
                  上传第一张图片
                </button>
              </div>
            ) : (
              <div className="image-grid">
                {images.map((image) => (
                  <article className="image-card" key={image.name}>
                    <div className="image-thumb">
                      <img src={image.url} alt={image.name} loading="lazy" />
                    </div>
                    <div className="image-info">
                      <p className="image-name">{image.name}</p>
                      <p className="image-meta">
                        {formatSize(image.size)}
                        {image.is_logo ? " · 当前 logo" : ""}
                      </p>
                    </div>
                    <div className="image-actions">
                      {image.is_logo ? (
                        <span className="image-tag">当前 logo</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void setAsLogo(image)}
                          disabled={imagesBusy}
                        >
                          设为 logo
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (!draft) {
                            setStatus({ kind: "error", text: "先打开一篇文章，再插入图片。" });
                            return;
                          }
                          insertMarkdown(image.markdown, false);
                          setStatus({
                            kind: "ok",
                            text: `图片已插入《${draft.title || "未命名文章"}》，发布后生效。`,
                          });
                        }}
                        disabled={!draft || imagesBusy}
                      >
                        插入正文
                      </button>
                      <button type="button" onClick={() => void copyImageMarkdown(image)}>
                        复制 Markdown
                      </button>
                      <button
                        className="image-delete"
                        type="button"
                        onClick={() => void removeImage(image)}
                        disabled={imagesBusy || image.is_logo}
                        title={image.is_logo ? "当前 logo 不能删除，先换用其他 logo。" : undefined}
                      >
                        删除
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </main>
      )}

      <input
        ref={bodyImageRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={handleBodyImage}
      />
      <input
        ref={libraryImageRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={handleLibraryImage}
      />

      {status.text && (
        <div className={`status-bar status-${status.kind}`} role="status">
          <button
            className="status-close"
            type="button"
            aria-label="关闭提示"
            onClick={() => setStatus({ kind: "idle", text: "" })}
          >
            ×
          </button>
          <p>{status.text}</p>
          {status.log && (
            <details>
              <summary>构建日志</summary>
              <pre>{status.log}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
