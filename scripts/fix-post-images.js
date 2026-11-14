// 把「图片放错位置」的文章自动修好，让 publish 不再产出裂图。
//
// 处理这几种情况：
//   1. 引用是裸文件名（如 ![](abc.png)）但文章是单文件 md  → 转成文章文件夹（md -> <同名>/index.md）
//   2. 引用的图片不在应处的位置（常见：Obsidian 把图存到了 vault 根目录）→ 按文件名找回来并移到位
//   3. 文件名里有空格，Markdown 会把空格后当成标题 → 改写成 ![](<带 空格 的名字>)
//   4. 引用的图片根本不存在 → 列出来并以非 0 退出，让 publish 中止，不发布坏页面
//
// 目标位置规则：
//   - 裸文件名            → 文章自己的文件夹（page bundle）
//   - image/...           → content/文章/image/...（通过 hugo.yaml 的 mount 映射成 assets/image）
//   - 其他带目录的路径     → assets/...（Hugo 的默认资源目录）
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const contentDir = path.join(root, "content");
const assetsDir = path.join(root, "assets");
const articleImageDir = path.join(contentDir, "文章", "image");

const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;

const actions = [];
const problems = [];
const unused = [];
let remoteRefs = 0;
const remoteFiles = new Set();

// 提取 ![](目标) 里的内容。不能用简单的 [^)]+：文件名本身可能带括号，
// 例如 IMG_6263(1).jpg，这时要按括号配平找到真正的右括号。
function extractRefs(text) {
    const out = [];
    let i = 0;
    while ((i = text.indexOf("![", i)) !== -1) {
        const close = text.indexOf("]", i + 2);
        if (close === -1) break;
        if (text[close + 1] !== "(") {
            i = close + 1;
            continue;
        }
        let depth = 1;
        let end = -1;
        for (let j = close + 2; j < text.length; j++) {
            const c = text[j];
            if (c === "(") depth++;
            else if (c === ")") {
                depth--;
                if (depth === 0) {
                    end = j;
                    break;
                }
            } else if (c === "\n" && depth === 1) {
                break;
            }
        }
        if (end === -1) {
            i = close + 1;
            continue;
        }
        const raw = text.slice(close + 2, end);
        let dest = raw.trim();
        if (dest.startsWith("<")) {
            const gt = dest.indexOf(">");
            if (gt !== -1) dest = dest.slice(1, gt);
        } else {
            const sp = dest.search(/\s/);
            if (sp !== -1) dest = dest.slice(0, sp);
        }
        out.push({ raw, dest, rawStart: close + 2, rawEnd: end });
        i = end + 1;
    }
    return out;
}

function walkFiles(dir, acc = []) {
    if (!fs.existsSync(dir)) return acc;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith(".")) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walkFiles(full, acc);
        else acc.push(full);
    }
    return acc;
}

function rel(p) {
    return path.relative(root, p).replace(/\\/g, "/");
}

// 全树图片索引：文件名(小写) -> 路径数组
const allFiles = walkFiles(contentDir).concat(walkFiles(assetsDir));
const byName = new Map();
for (const f of allFiles) {
    if (!IMG_EXT.test(f)) continue;
    const key = path.basename(f).toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(f);
}

// 把一个单文件的 md 变成文章文件夹：<dir>/<name>.md -> <dir>/<name>/index.md
function toBundle(mdPath) {
    if (path.basename(mdPath) === "index.md") return mdPath;
    const dir = path.dirname(mdPath);
    const base = path.basename(mdPath, ".md");
    const target = path.join(dir, base);
    fs.mkdirSync(target, { recursive: true });
    const newMd = path.join(target, "index.md");
    if (fs.existsSync(newMd)) {
        problems.push(`${rel(mdPath)} 想转成文章文件夹，但 ${rel(newMd)} 已存在，跳过`);
        return mdPath;
    }
    fs.renameSync(mdPath, newMd);
    actions.push(`转成文章文件夹: ${rel(mdPath)} -> ${rel(newMd)}`);
    return newMd;
}

// 在别处找到同名图片，搬到 targetDir
function moveInto(targetDir, fileName) {
    const hits = byName.get(fileName.toLowerCase()) || [];
    const already = path.join(targetDir, fileName);
    if (fs.existsSync(already)) return true;
    if (hits.length === 0) return false;
    if (hits.length > 1) {
        problems.push(`同名图片有 ${hits.length} 份，无法判断用哪张: ${fileName} -> ${hits.map(rel).join(" | ")}`);
        return false;
    }
    fs.mkdirSync(targetDir, { recursive: true });
    fs.renameSync(hits[0], already);
    actions.push(`移动图片: ${rel(hits[0])} -> ${rel(already)}`);
    return true;
}

const mds = walkFiles(contentDir).filter((f) => f.toLowerCase().endsWith(".md") && path.basename(f) !== "_index.md");

for (let mdPath of mds) {
    const text = fs.readFileSync(mdPath, "utf8");
    const refs = extractRefs(text);
    if (refs.length === 0) continue;

    const edits = [];
    const used = new Set();

    for (const r of refs) {
        const raw = r.raw.trim();
        if (!raw) continue;

        // 远程图床或历史上已坏掉的语法：不归我们管
        if (/https?:\/\//i.test(raw) || raw.startsWith("[") || raw.startsWith("//")) {
            remoteRefs++;
            remoteFiles.add(rel(mdPath));
            continue;
        }

        let ref = r.dest.trim();
        try {
            ref = decodeURIComponent(ref);
        } catch (e) {
            /* 保留原样 */
        }
        ref = ref.replace(/^\.\//, "").replace(/^\/+/, "").replace(/\\/g, "/");
        if (!ref) continue;
        used.add(path.basename(ref).toLowerCase());

        const dir = path.dirname(mdPath);

        // 文件名里带空格：Hugo 会把空格之后当标题，必须用 <...> 包起来
        if (raw !== r.dest && fs.existsSync(path.join(dir, raw))) {
            edits.push({ start: r.rawStart, end: r.rawEnd, text: `<${raw}>` });
            actions.push(`加尖括号（文件名含空格）: ${raw}（${rel(mdPath)}）`);
            continue;
        }

        const bare = !ref.includes("/");

        // 裸文件名：必须落在文章文件夹里
        // 注意：单文件 md 的"同目录图片"Hugo 是解析不了的（只有 bundle 里的才算页面资源），
        // 所以只要出现裸文件名引用，单文件文章就要转成文章文件夹，图片跟着搬进去。
        if (bare) {
            const name = path.basename(ref);
            const sibling = path.join(dir, name);

            if (path.basename(mdPath) !== "index.md") {
                mdPath = toBundle(mdPath);
                const d = path.dirname(mdPath);
                const dest = path.join(d, name);
                if (fs.existsSync(sibling) && !fs.existsSync(dest)) {
                    fs.renameSync(sibling, dest);
                    actions.push(`移动图片: ${rel(sibling)} -> ${rel(dest)}`);
                } else if (!fs.existsSync(dest) && !moveInto(d, name)) {
                    problems.push(`找不到图片: ${ref}（来自 ${rel(mdPath)}）`);
                }
                continue;
            }

            if (fs.existsSync(sibling)) continue;
            if (!moveInto(dir, name)) {
                problems.push(`找不到图片: ${ref}（来自 ${rel(mdPath)}）`);
            }
            continue;
        }

        // 带目录的路径：先看已就位，再看 assets
        const candidates = [path.join(dir, ref), path.join(assetsDir, ref), path.join(articleImageDir, ref)];
        if (candidates.some((p) => fs.existsSync(p))) continue;

        const targetDir = ref.startsWith("image/")
            ? path.join(articleImageDir, path.dirname(ref.slice("image/".length)))
            : path.join(assetsDir, path.dirname(ref));
        if (!moveInto(targetDir, path.posix.basename(ref))) {
            problems.push(`找不到图片: ${ref}（来自 ${rel(mdPath)}）`);
        }
    }

    if (edits.length) {
        let out = text;
        for (const e of edits.sort((a, b) => b.start - a.start)) {
            out = out.slice(0, e.start) + e.text + out.slice(e.end);
        }
        fs.writeFileSync(mdPath, out, "utf8");
    }

    // 顺手提示：文章文件夹里没被正文引用的图片（照样会被发布，占体积）
    const dir = path.dirname(mdPath);
    if (path.basename(mdPath) === "index.md") {
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!f.isFile() || !IMG_EXT.test(f.name)) continue;
            if (!used.has(f.name.toLowerCase())) {
                const kb = Math.round(fs.statSync(path.join(dir, f.name)).size / 1024);
                unused.push(`${rel(path.join(dir, f.name))}（${kb} KB）`);
            }
        }
    }
}

for (const a of actions) console.log("[图片] " + a);
if (problems.length) {
    console.error("\n图片有问题，已中止（修好后重跑即可）：");
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
}
if (unused.length) {
    console.log("\n[提示] 这些图片没有被正文引用，但仍会被发布，可以考虑删掉：");
    for (const u of unused.slice(0, 10)) console.log("  · " + u);
    if (unused.length > 10) console.log(`  · …另有 ${unused.length - 10} 张`);
}
if (remoteRefs) {
    console.log(`[提示] 跳过 ${remoteRefs} 处远程图床引用（分布在 ${remoteFiles.size} 个旧文件里），不参与本地检查。`);
}
console.log(`图片检查通过（修正 ${actions.length} 处）`);
