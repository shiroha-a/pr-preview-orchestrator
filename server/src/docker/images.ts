/** Docker image identity needed to decide preview-orphan cleanup (issue #67). */
export interface DockerImageInfo {
  /** Full image id ("sha256:..."). */
  id: string;
  /** Value of the com.docker.compose.project label, or null when absent. */
  project: string | null;
  /** Repo tags ("name:tag"); empty for dangling images. */
  repoTags: string[];
}

// プレビューのcomposeプロジェクト名は必ずこの接頭辞を持つ(service.tsの命名規則)。
// ホストに共存する他のcomposeプロジェクトのイメージを誤って消さないための境界。
const PREVIEW_PROJECT_PREFIX = "preview-";

/**
 * Format for `docker image inspect` producing one parseable line per image.
 * `with index .Config "Labels"` guards images whose Config has no Labels key
 * at all (plain pulled images), which would make a bare `index` error out.
 */
export const IMAGE_INSPECT_FORMAT =
  '{{.Id}}\t{{with index .Config "Labels"}}{{index . "com.docker.compose.project"}}{{end}}\t{{join .RepoTags " "}}';

/**
 * Parse `docker image inspect` lines produced with IMAGE_INSPECT_FORMAT.
 * Non-matching lines (e.g. "No such image" errors for ids removed between the
 * listing and the inspect) are skipped.
 */
export function parseImageInspectLines(lines: string[]): DockerImageInfo[] {
  const images: DockerImageInfo[] = [];
  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length < 3 || !parts[0].startsWith("sha256:")) continue;
    // ラベル自体が無いと空文字、Labelsはあるがキーが無い場合は "<no value>" になる。
    const project = parts[1] && parts[1] !== "<no value>" ? parts[1] : null;
    images.push({
      id: parts[0],
      project,
      repoTags: parts[2].split(" ").filter(Boolean),
    });
  }
  return images;
}

/**
 * Select images built by preview compose projects that no longer have an
 * active preview (issue #67). Images of other compose projects on the host are
 * never selected; images still referenced by containers are additionally
 * protected by using a non-forced `docker rmi` at removal time.
 */
export function selectOrphanImages(
  images: DockerImageInfo[],
  activeProjects: Iterable<string>,
): DockerImageInfo[] {
  const active = new Set(activeProjects);
  return images.filter(
    (img) =>
      img.project !== null &&
      img.project.startsWith(PREVIEW_PROJECT_PREFIX) &&
      !active.has(img.project),
  );
}

/** Refs to pass to `docker rmi`: tags when present, the id for dangling images. */
export function imageRemovalRefs(img: DockerImageInfo): string[] {
  return img.repoTags.length > 0 ? img.repoTags : [img.id];
}
