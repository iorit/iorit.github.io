// 把「图片放错位置」的文章自动修好，让 publish 不再产出裂图。
//
// 处理三种情况：
//   1. 引用是裸文件名（如 ![](abc.png)）但文章是单文件 md  → 转成文章文件夹（md -> <同名>/index.md）
//   2. 引用的图片不在应处的位置（常见：Obsidian 把图存到了 vault 根目录）→ 按文件名找回来并移到位
//   3. 引用的图片根本不存在 → 列出来并以非 0 退出，让 publish 中止，不发布坏页面
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
const REF = /!\[[^\]]*\]\(([^)\s]+)/g;

const actions = [];
const problems = [];

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
    const refs = [...text.matchAll(REF)].map((m) => m[1]);
    if (refs.length === 0) continue;

    for (const rawRef of refs) {
        if (/^(https?:)?\/\//i.test(rawRef)) continue;
        const ref = decodeURIComponent(rawRef).replace(/^\.\//, "").replace(/^\/+/, "");
        const bare = !ref.includes("/");

        // 裸文件名：必须落在文章文件夹里
        if (bare) {
            let dir = path.dirname(mdPath);
            if (!fs.existsSync(path.join(dir, ref))) {
                if (path.basename(mdPath) !== "index.md") {
                    mdPath = toBundle(mdPath);
                    dir = path.dirname(mdPath);
                }
            }
            if (fs.existsSync(path.join(dir, ref))) continue;
            if (!moveInto(path.dirname(mdPath), path.basename(ref))) {
                problems.push(`找不到图片: ${ref}（来自 ${rel(mdPath)}）`);
            }
            continue;
        }

        // 带目录的路径：先看已就位，再看 assets
        const candidates = [path.join(path.dirname(mdPath), ref), path.join(assetsDir, ref), path.join(articleImageDir, ref)];
        if (candidates.some((p) => fs.existsSync(p))) continue;

        const targetDir = ref.startsWith("image/")
            ? path.join(articleImageDir, path.dirname(ref.slice("image/".length)))
            : path.join(assetsDir, path.dirname(ref));
        if (!moveInto(targetDir, path.posix.basename(ref))) {
            problems.push(`找不到图片: ${ref}（来自 ${rel(mdPath)}）`);
        }
    }
}

for (const a of actions) console.log("[图片] " + a);
if (problems.length) {
    console.error("\n图片有问题，已中止（修好后重跑即可）：");
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
}
console.log(`图片检查通过（修正 ${actions.length} 处）`);
