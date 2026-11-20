import { createHash } from "node:crypto";

import {
  findProjectedDependency,
  toComponentDetail,
  toComponentGraph,
  toDependencyEvidence,
  toFileGraph,
  toProjectGraphOptions,
  toSnapshotOverview,
  type ComponentDetail,
  type ComponentFilesPage,
  type DependencyEvidencePage,
  type DependencyEvidenceQuery,
  type DiagnosticsPage,
  type GraphQuery,
  type GraphResponse,
  type PageQuery,
  type ProjectionQuery,
  type SnapshotList,
  type SnapshotListItem,
  type SnapshotOverview
} from "@archmind/contracts";
import { canonicalJson } from "@archmind/domain";
import { HttpException, Inject, Injectable } from "@nestjs/common";

import { SNAPSHOT_READER, type LoadedSnapshot, type SnapshotReader } from "./snapshot-reader.js";

function missing(code: string, message: string): never {
  throw new HttpException({ error: { code, message } }, 404);
}

function paginate<T>(items: readonly T[], query: PageQuery, scope: object) {
  const key = createHash("sha256").update(canonicalJson(scope)).digest("hex");
  let start = 0;
  if (query.cursor !== undefined) {
    const [cursorKey, offset, extra] = query.cursor.split(".");
    if (cursorKey === key && offset !== undefined && /^\d+$/.test(offset) && extra === undefined) {
      start = Number(offset);
    }
    if (!Number.isSafeInteger(start) || start < 1 || start > items.length) {
      throw new HttpException(
        { error: { code: "INVALID_CURSOR", message: "Invalid continuation cursor." } },
        400
      );
    }
  }
  const end = start + query.limit;
  return {
    items: items.slice(start, end),
    nextCursor: end < items.length ? `${key}.${end}` : null
  };
}

@Injectable()
export class ExplorerService {
  constructor(@Inject(SNAPSHOT_READER) private readonly reader: SnapshotReader) {}

  async list(query: PageQuery): Promise<SnapshotList> {
    const page = paginate(await this.reader.list(), query, { kind: "snapshots" });
    const items: SnapshotListItem[] = [];
    for (const identity of page.items) {
      items.push(await this.reader.summarize(identity));
    }
    return { items, nextCursor: page.nextCursor };
  }

  async overview(id: string): Promise<SnapshotOverview> {
    const { identity, snapshot } = await this.get(id);
    return toSnapshotOverview(identity, snapshot);
  }

  async diagnostics(id: string, query: PageQuery): Promise<DiagnosticsPage> {
    const { snapshot } = await this.get(id);
    return paginate(snapshot.diagnostics, query, {
      id,
      hash: snapshot.contentHash,
      kind: "diagnostics"
    });
  }

  async graph(id: string, query: GraphQuery): Promise<GraphResponse> {
    const loaded = await this.get(id);
    const options = toProjectGraphOptions(query);
    if (query.level === "file" && query.componentId !== undefined) {
      this.component(loaded, query.componentId);
      return toFileGraph(loaded.projector.projectFileGraph(query.componentId, options));
    }
    return toComponentGraph(loaded.projector.projectGraph(options));
  }

  async detail(id: string, componentId: string, query: ProjectionQuery): Promise<ComponentDetail> {
    const loaded = await this.get(id);
    return toComponentDetail(
      this.component(loaded, componentId),
      loaded.snapshot.components,
      loaded.projector.projectGraph(toProjectGraphOptions(query))
    );
  }

  async files(id: string, componentId: string, query: PageQuery): Promise<ComponentFilesPage> {
    const loaded = await this.get(id);
    const component = this.component(loaded, componentId);
    const { files } = loaded.projector.projectFileGraph(componentId, { depth: component.depth });
    return paginate(files, query, {
      id,
      hash: loaded.snapshot.contentHash,
      componentId,
      kind: "files"
    });
  }

  async evidence(id: string, query: DependencyEvidenceQuery): Promise<DependencyEvidencePage> {
    const loaded = await this.get(id);
    const options = toProjectGraphOptions(query);
    const edge = findProjectedDependency(loaded.projector.projectGraph(options), query);
    if (!edge) missing("DEPENDENCY_NOT_FOUND", "Projected dependency not found.");
    const page = paginate(edge.evidenceImportIds, query, {
      id,
      hash: loaded.snapshot.contentHash,
      options,
      from: query.from,
      to: query.to,
      kind: "evidence"
    });
    return {
      items: toDependencyEvidence(page.items, loaded.importsById, loaded.filesById),
      nextCursor: page.nextCursor
    };
  }

  private component({ snapshot }: LoadedSnapshot, componentId: string) {
    return (
      snapshot.components.find(({ id }) => id === componentId) ??
      missing("COMPONENT_NOT_FOUND", "Component not found.")
    );
  }

  private async get(id: string) {
    const identity = (await this.reader.list()).find((entry) => entry.id === id);
    if (!identity) missing("SNAPSHOT_NOT_FOUND", "Snapshot not found.");
    const result = await this.reader.load(identity);
    if (result.status === "invalid") {
      throw new HttpException({ error: { code: "INVALID_SNAPSHOT", message: result.reason } }, 422);
    }
    return { identity, ...result.data };
  }
}
