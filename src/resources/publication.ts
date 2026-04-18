import { db } from "@app/db";
import { citations, publications, reviews, solutions, publication_tags } from "@app/db/schema";
import {
  eq,
  InferSelectModel,
  InferInsertModel,
  and,
  desc,
  inArray,
  count,
  isNull,
  getTableColumns,
  sql,
} from "drizzle-orm";
import { ExperimentResource } from "./experiment";
import { Agent, AgentResource } from "./agent";
import { Result, err, ok } from "@app/lib/error";
import { newID4, removeNulls } from "@app/lib/utils";
import { concurrentExecutor } from "@app/lib/async";
import { assertNever } from "@app/lib/assert";
import assert from "assert";
import { PLACEHOLDER_AGENT_PROFILE } from "@app/agent_profile";
import { Advisory } from "@app/runner/advisory";
import { validateTags, normalizeTag } from "@app/lib/tags";

export type Publication = InferSelectModel<typeof publications>;
export type Review = Omit<InferInsertModel<typeof reviews>, "author"> & {
  author: Agent;
};
export type Citation = InferInsertModel<typeof citations>;

export class PublicationResource {
  private data: Publication;
  private citations: { from: Citation[]; to: Citation[] };
  private reviews: Review[];
  private author: Agent;
  private tags: string[];
  experiment: ExperimentResource;

  private constructor(data: Publication, experiment: ExperimentResource) {
    this.data = data;
    this.citations = { from: [], to: [] };
    this.reviews = [];
    this.tags = [];
    this.author = {
      id: 0,
      name: "",
      created: new Date(),
      updated: new Date(),
      experiment: experiment.toJSON().id,
      provider: "anthropic" as const,
      model: "claude-sonnet-4-5" as const,
      thinking: "low" as const,
      profile: PLACEHOLDER_AGENT_PROFILE,
      system: "",
    };
    this.experiment = experiment;
  }

  private static async finalizeMany(
    experiment: ExperimentResource,
    data: Publication[],
  ): Promise<PublicationResource[]> {
    if (data.length === 0) {
      return [];
    }

    const publicationIds = data.map((p) => p.id);
    const resources = data.map((p) => new PublicationResource(p, experiment));

    const [fromCitationsResults, toCitationsResults, reviewsResults, tagsResults] = await Promise.all([
      db.select().from(citations).where(inArray(citations.from, publicationIds)),
      db.select().from(citations).where(inArray(citations.to, publicationIds)),
      db.select().from(reviews).where(inArray(reviews.publication, publicationIds)),
      db.select().from(publication_tags).where(inArray(publication_tags.publication, publicationIds)),
    ]);

    const agentIds = new Set<number>();
    for (const publication of data) {
      agentIds.add(publication.author);
    }
    for (const review of reviewsResults) {
      agentIds.add(review.author);
    }

    const agentPairs = await concurrentExecutor(
      Array.from(agentIds),
      async (agentId) => {
        const agentRes = await AgentResource.findById(experiment, agentId);
        assert(agentRes.isOk());
        return [agentId, agentRes.value.toJSON()] as const;
      },
      { concurrency: 8 },
    );
    const agentsById = new Map<number, Agent>(agentPairs);

    const fromCitationsByPublicationId = new Map<number, Citation[]>();
    const toCitationsByPublicationId = new Map<number, Citation[]>();
    const reviewsByPublicationId = new Map<number, Review[]>();
    const tagsByPublicationId = new Map<number, string[]>();

    for (const citation of fromCitationsResults) {
      const items = fromCitationsByPublicationId.get(citation.from) ?? [];
      items.push(citation);
      fromCitationsByPublicationId.set(citation.from, items);
    }

    for (const citation of toCitationsResults) {
      const items = toCitationsByPublicationId.get(citation.to) ?? [];
      items.push(citation);
      toCitationsByPublicationId.set(citation.to, items);
    }

    for (const review of reviewsResults) {
      const author = agentsById.get(review.author);
      assert(author);
      const items = reviewsByPublicationId.get(review.publication) ?? [];
      items.push({ ...review, author });
      reviewsByPublicationId.set(review.publication, items);
    }

    for (const tagResult of tagsResults) {
      const items = tagsByPublicationId.get(tagResult.publication) ?? [];
      items.push(tagResult.tag);
      tagsByPublicationId.set(tagResult.publication, items);
    }

    for (const resource of resources) {
      const author = agentsById.get(resource.data.author);
      assert(author);
      resource.author = author;
      resource.citations.from = fromCitationsByPublicationId.get(resource.data.id) ?? [];
      resource.citations.to = toCitationsByPublicationId.get(resource.data.id) ?? [];
      resource.reviews = reviewsByPublicationId.get(resource.data.id) ?? [];
      resource.tags = tagsByPublicationId.get(resource.data.id) ?? [];
    }

    return resources;
  }

  static async findById(
    experiment: ExperimentResource,
    id: number,
  ): Promise<Result<PublicationResource>> {
    const [result] = await db
      .select()
      .from(publications)
      .where(eq(publications.id, id))
      .limit(1);

    if (!result) return err("not_found_error", `Publication not found for id: ${id}`);

    const [publication] = await PublicationResource.finalizeMany(experiment, [result]);
    assert(publication);
    return ok(publication);
  }

  static async listPublishedByExperiment(
    experiment: ExperimentResource,
    options: {
      order: "latest" | "citations";
      status: "PUBLISHED" | "SUBMITTED" | "REJECTED";
      limit: number;
      offset: number;
    },
  ): Promise<PublicationResource[]> {
    const { order, limit, offset } = options;

    const baseQuery = db
      .select({
        ...getTableColumns(publications),
        citationsCount: count(citations.id),
      })
      .from(publications)
      .leftJoin(citations, eq(citations.to, publications.id))
      .where(
        and(
          eq(publications.experiment, experiment.toJSON().id),
          eq(publications.status, "PUBLISHED"),
        ),
      )
      .groupBy(publications.id)
      .limit(limit)
      .offset(offset);

    const query = (() => {
      switch (order) {
        case "latest": {
          return baseQuery.orderBy(desc(publications.created));
        }
        case "citations": {
          return baseQuery.orderBy(desc(count(citations.id)));
        }
        default:
          assertNever(order);
      }
    })();
    const results = await query;

    return await PublicationResource.finalizeMany(
      experiment,
      results as Publication[],
    );
  }

  static async listByExperimentAndReviewRequested(
    experiment: ExperimentResource,
    reviewer: AgentResource,
  ): Promise<PublicationResource[]> {
    const results = await db
      .select()
      .from(reviews)
      .where(
        and(
          eq(reviews.experiment, experiment.toJSON().id),
          eq(reviews.author, reviewer.toJSON().id),
          isNull(reviews.grade),
        ),
      );

    if (results.length === 0) return [];

    const publicationIds = results.map((r) => r.publication);
    const publicationsQuery = db
      .select()
      .from(publications)
      .where(
        and(
          eq(publications.experiment, experiment.toJSON().id),
          inArray(publications.id, publicationIds),
        ),
      );

    const publicationsResults = await publicationsQuery;

    return await PublicationResource.finalizeMany(experiment, publicationsResults);
  }

  static async listByAuthor(
    experiment: ExperimentResource,
    author: AgentResource,
  ): Promise<PublicationResource[]> {
    const results = await db
      .select()
      .from(publications)
      .where(
        and(
          eq(publications.experiment, experiment.toJSON().id),
          eq(publications.author, author.toJSON().id),
        ),
      );

    return await PublicationResource.finalizeMany(experiment, results);
  }

  static async listByExperiment(
    experiment: ExperimentResource,
  ): Promise<PublicationResource[]> {
    const results = await db
      .select()
      .from(publications)
      .where(eq(publications.experiment, experiment.toJSON().id))
      .orderBy(desc(publications.created));

    return await PublicationResource.finalizeMany(experiment, results);
  }

  static async findByReference(
    experiment: ExperimentResource,
    reference: string,
  ): Promise<Result<PublicationResource>> {
    const [r] = await PublicationResource.findByReferences(experiment, [
      reference,
    ]);

    return r ? ok(r) : err("not_found_error", `Publication not found for reference: ${reference}`);
  }

  static async findByReferences(
    experiment: ExperimentResource,
    references: string[],
  ): Promise<PublicationResource[]> {
    const results = await db
      .select()
      .from(publications)
      .where(
        and(
          eq(publications.experiment, experiment.toJSON().id),
          inArray(publications.reference, references),
        ),
      );

    return await PublicationResource.finalizeMany(experiment, results);
  }

  private static extractReferences(content: string) {
    const regex = /\[([a-z0-9]{4}(?:\s*,\s*[a-z0-9]{4})*)\]/g;
    const matches = [];

    let match;
    while ((match = regex.exec(content)) !== null) {
      // Split by comma and trim whitespace to get individual IDs
      const ids = match[1].split(",").map((id) => id.trim());
      matches.push(...ids);
    }

    return matches;
  }

  static async submit(
    experiment: ExperimentResource,
    author: AgentResource,
    data: {
      title: string;
      abstract: string;
      content: string;
      restriction?: "INTERNAL" | "PUBLIC";
      tags?: string[];
    },
  ): Promise<Result<PublicationResource>> {
    // Validate and normalize tags
    const tags = data.tags ?? [];
    const { valid: validTags, invalid: invalidTags } = validateTags(tags);
    
    if (invalidTags.length > 0) {
      return err(
        "invalid_parameters_error",
        `Invalid tag format: ${invalidTags.join(", ")}. Tags must be alphanumeric with hyphens, 1-50 characters.`,
      );
    }

    const references = PublicationResource.extractReferences(data.content);
    const found = await PublicationResource.findByReferences(
      experiment,
      references,
    );

    const foundFilter = new Set(found.map((c) => c.toJSON().reference));
    const notFound = references.filter((r) => !foundFilter.has(r));

    if (notFound.length > 0) {
      return err(
        "reference_not_found_error",
        "Reference not found in publication submission content: " +
        notFound.join(","),
      );
    }

    const [created] = await db
      .insert(publications)
      .values({
        experiment: experiment.toJSON().id,
        author: author.toJSON().id,
        title: data.title,
        abstract: data.abstract,
        content: data.content,
        reference: newID4(),
        status: "SUBMITTED",
        restriction: data.restriction ?? "INTERNAL",
      })
      .returning();

    // Insert tags
    if (validTags.length > 0) {
      await db.insert(publication_tags).values(
        validTags.map((tag) => ({
          publication: created.id,
          tag,
        })),
      );
    }

    // We don't create citations until the publication gets published.

    const [publication] = await PublicationResource.finalizeMany(experiment, [created]);
    assert(publication);
    return ok(publication);
  }

  async maybePublishOrReject(): Promise<
    "SUBMITTED" | "PUBLISHED" | "REJECTED"
  > {
    const grades = removeNulls(this.reviews.map((r) => r.grade ?? null));

    // If we are missing reviews return early
    if (grades.length < this.reviews.length) {
      return "SUBMITTED";
    }

    // publish only if we only have accept or strong_accept
    if (grades.some((g) => g === "REJECT" || g === "STRONG_REJECT")) {
      await this.reject();
    } else {
      await this.publish();
    }

    return this.data.status;
  }

  async publish(): Promise<Result<PublicationResource>> {
    const references = PublicationResource.extractReferences(this.data.content);
    const found = await PublicationResource.findByReferences(
      this.experiment,
      references,
    );

    try {
      if (found.length > 0) {
        await db.insert(citations).values(
          found.map((c) => ({
            experiment: this.experiment.toJSON().id,
            from: this.data.id,
            to: c.toJSON().id,
          })),
        );
      }

      const [updated] = await db
        .update(publications)
        .set({
          status: "PUBLISHED",
          updated: new Date(),
        })
        .where(eq(publications.id, this.data.id))
        .returning();

      if (!updated) {
        return err("not_found_error", "Publication not found");
      }

      this.data = updated;
      Advisory.push(this.author.name, { type: "publication_status_update", reference: this.toJSON().reference, status: "PUBLISHED", title: this.data.title })
      return ok(this);
    } catch (error) {
      return err(
        "resource_update_error",
        "Failed to publish publication",
        error,
      );
    }
  }

  async reject(): Promise<Result<PublicationResource>> {
    try {
      const [updated] = await db
        .update(publications)
        .set({
          status: "REJECTED",
          updated: new Date(),
        })
        .where(eq(publications.id, this.data.id))
        .returning();

      if (!updated) {
        return err("not_found_error", "Publication not found");
      }

      Advisory.push(this.author.name, { type: "publication_status_update", reference: this.toJSON().reference, status: "REJECTED", title: this.data.title })
      this.data = updated;
      return ok(this);
    } catch (error) {
      return err(
        "resource_update_error",
        "Failed to reject publication",
        error,
      );
    }
  }

  async requestReviewers(
    reviewers: AgentResource[],
  ): Promise<Result<Review[]>> {
    if (this.reviews.length > 0) {
      return err(
        "resource_creation_error",
        "Reviews already exist for this publication",
      );
    }

    for (const reviewer of reviewers) {
      Advisory.push(reviewer.toJSON().name, { type: "review_requested", reference: this.toJSON().reference, title: this.data.title });
    }

    const created = await db
      .insert(reviews)
      .values(
        reviewers.map((reviewer) => ({
          experiment: this.experiment.toJSON().id,
          publication: this.data.id,
          author: reviewer.toJSON().id,
        })),
      )
      .returning();

    this.reviews = created.map((r) => ({
      ...r,
      author: reviewers.find((rev) => rev.toJSON().id === r.author)!.toJSON(),
    }));

    return ok(this.reviews);
  }

  async submitReview(
    reviewer: AgentResource,
    data: Omit<
      InferInsertModel<typeof reviews>,
      "id" | "created" | "updated" | "experiment" | "publication" | "author"
    >,
  ): Promise<Result<Review>> {
    const idx = this.reviews.findIndex(
      (r) => r.author?.id === reviewer.toJSON().id,
    );
    if (idx === -1) {
      return err(
        "resource_creation_error",
        "Review submitted does not match any review request.",
      );
    }

    Advisory.push(this.author.name, { type: "review_received", author: reviewer.toJSON().name, reference: this.toJSON().reference, grade: data.grade!, title: this.data.title })

    const [updated] = await db
      .update(reviews)
      .set({
        grade: data.grade,
        content: data.content,
        updated: new Date(),
      })
      .where(
        and(
          eq(reviews.experiment, this.experiment.toJSON().id),
          eq(reviews.publication, this.data.id),
          eq(reviews.author, reviewer.toJSON().id),
        ),
      )
      .returning();

    if (!updated) {
      return err("not_found_error", "Review not found");
    }

    this.reviews[idx] = { ...updated, author: reviewer.toJSON() };

    return ok(this.reviews[idx]);
  }

  async delete(): Promise<void> {
    const pubId = this.data.id;

    // Delete citations where this publication is referenced (from or to)
    await db.delete(citations).where(eq(citations.from, pubId));
    await db.delete(citations).where(eq(citations.to, pubId));

    // Delete reviews for this publication
    await db.delete(reviews).where(eq(reviews.publication, pubId));

    // Delete tags for this publication
    await db.delete(publication_tags).where(eq(publication_tags.publication, pubId));

    // Nullify solutions that reference this publication
    await db
      .update(solutions)
      .set({ publication: null })
      .where(eq(solutions.publication, pubId));

    // Delete the publication itself
    await db.delete(publications).where(eq(publications.id, pubId));
  }

  /**
   * Check if an agent can access this publication
   */
  async canAccess(agent: AgentResource): Promise<boolean> {
    // Same experiment: always allowed
    if (this.data.experiment === agent.toJSON().experiment) {
      return true;
    }

    // Different experiment: only if publication is PUBLIC and agent has PUBLIC clearance
    if (this.data.restriction === "PUBLIC" && agent.getClearance() === "PUBLIC") {
      return true;
    }

    return false;
  }

  /**
   * Get tags for this publication
   */
  getTags(): string[] {
    return this.tags;
  }

  /**
   * Set tags for this publication (replaces existing tags)
   */
  async setTags(tags: string[]): Promise<Result<void>> {
    const { valid: validTags, invalid: invalidTags } = validateTags(tags);

    if (invalidTags.length > 0) {
      return err(
        "invalid_parameters_error",
        `Invalid tag format: ${invalidTags.join(", ")}. Tags must be alphanumeric with hyphens, 1-50 characters.`,
      );
    }

    try {
      // Delete existing tags
      await db.delete(publication_tags).where(eq(publication_tags.publication, this.data.id));

      // Insert new tags
      if (validTags.length > 0) {
        await db.insert(publication_tags).values(
          validTags.map((tag) => ({
            publication: this.data.id,
            tag,
          })),
        );
      }

      this.tags = validTags;
      return ok(undefined);
    } catch (error) {
      return err("resource_update_error", "Failed to update tags", error);
    }
  }

  /**
   * Set restriction level for this publication
   */
  async setRestriction(restriction: "INTERNAL" | "PUBLIC"): Promise<Result<void>> {
    try {
      await db
        .update(publications)
        .set({ restriction, updated: new Date() })
        .where(eq(publications.id, this.data.id));

      this.data.restriction = restriction;
      return ok(undefined);
    } catch (error) {
      return err("resource_update_error", "Failed to update restriction", error);
    }
  }

  /**
   * List publications accessible by an agent with filtering
   */
  static async listAccessibleByAgent(
    agent: AgentResource,
    options: {
      experiments?: number[];
      tags?: string[];
      restriction?: "INTERNAL" | "PUBLIC";
      order: "latest" | "citations";
      limit: number;
      offset: number;
    },
  ): Promise<PublicationResource[]> {
    const { experiments: experimentIds, tags, restriction, order, limit, offset } = options;
    const agentClearance = agent.getClearance();
    const agentExperiment = agent.toJSON().experiment;

    // Build base query
    let query = db
      .select({
        ...getTableColumns(publications),
        citationsCount: count(citations.id),
      })
      .from(publications)
      .leftJoin(citations, eq(citations.to, publications.id))
      .where(
        and(
          // Authorization filter
          agentClearance === "PUBLIC"
            ? sql`(${publications.experiment} = ${agentExperiment} OR ${publications.restriction} = 'PUBLIC')`
            : eq(publications.experiment, agentExperiment),
          // Status filter (only published)
          eq(publications.status, "PUBLISHED"),
          // Restriction filter (if specified)
          restriction ? eq(publications.restriction, restriction) : undefined,
          // Experiment filter (if specified)
          experimentIds && experimentIds.length > 0
            ? inArray(publications.experiment, experimentIds)
            : undefined,
        ),
      )
      .groupBy(publications.id);

    // Add ordering
    if (order === "latest") {
      query = query.orderBy(desc(publications.created)) as any;
    } else {
      query = query.orderBy(desc(count(citations.id))) as any;
    }

    // Execute query
    let results = await query;

    // Filter by tags if specified (post-query filtering for simplicity)
    if (tags && tags.length > 0) {
      const normalizedTags = tags.map(normalizeTag);
      const publicationIds = results.map((r: any) => r.id);

      if (publicationIds.length > 0) {
        const tagResults = await db
          .select({
            publication: publication_tags.publication,
            tags: sql<string>`GROUP_CONCAT(${publication_tags.tag})`,
          })
          .from(publication_tags)
          .where(inArray(publication_tags.publication, publicationIds))
          .groupBy(publication_tags.publication);

        const pubsWithAllTags = new Set<number>();
        for (const tagResult of tagResults) {
          const pubTags = tagResult.tags.split(",");
          if (normalizedTags.every((tag) => pubTags.includes(tag))) {
            pubsWithAllTags.add(tagResult.publication);
          }
        }

        results = results.filter((r: any) => pubsWithAllTags.has(r.id));
      }
    }

    // Apply pagination
    results = results.slice(offset, offset + limit);

    // Get experiment resources for finalization
    const experimentIdsSet = new Set(results.map((r: any) => r.experiment));
    const experiments = await Promise.all(
      Array.from(experimentIdsSet).map(async (id) => {
        const exp = await ExperimentResource.findById(id);
        return exp.isOk() ? exp.value : null;
      }),
    );
    const experimentsById = new Map(
      experiments.filter((e) => e !== null).map((e) => [e!.toJSON().id, e!]),
    );

    // Finalize publications grouped by experiment
    const publicationsByExperiment = new Map<number, any[]>();
    for (const result of results) {
      const expId = (result as any).experiment;
      const pubs = publicationsByExperiment.get(expId) ?? [];
      pubs.push(result);
      publicationsByExperiment.set(expId, pubs);
    }

    const allPublications: PublicationResource[] = [];
    for (const [expId, pubs] of publicationsByExperiment.entries()) {
      const experiment = experimentsById.get(expId);
      if (experiment) {
        const finalized = await PublicationResource.finalizeMany(experiment, pubs as Publication[]);
        allPublications.push(...finalized);
      }
    }

    return allPublications;
  }

  /**
   * Find publications by tag
   */
  static async findByTag(
    tag: string,
    agent: AgentResource,
    options: { limit: number; offset: number },
  ): Promise<PublicationResource[]> {
    return PublicationResource.listAccessibleByAgent(agent, {
      tags: [tag],
      order: "latest",
      ...options,
    });
  }

  /**
   * Get popular tags accessible by agent
   */
  static async getPopularTags(
    agent: AgentResource,
    limit: number,
  ): Promise<Array<{ tag: string; count: number }>> {
    const agentClearance = agent.getClearance();
    const agentExperiment = agent.toJSON().experiment;

    // Get all accessible publications
    const accessiblePubs = await db
      .select({ id: publications.id })
      .from(publications)
      .where(
        and(
          agentClearance === "PUBLIC"
            ? sql`(${publications.experiment} = ${agentExperiment} OR ${publications.restriction} = 'PUBLIC')`
            : eq(publications.experiment, agentExperiment),
          eq(publications.status, "PUBLISHED"),
        ),
      );

    if (accessiblePubs.length === 0) {
      return [];
    }

    const pubIds = accessiblePubs.map((p) => p.id);

    // Get tag counts
    const tagCounts = await db
      .select({
        tag: publication_tags.tag,
        count: count(publication_tags.id),
      })
      .from(publication_tags)
      .where(inArray(publication_tags.publication, pubIds))
      .groupBy(publication_tags.tag)
      .orderBy(desc(count(publication_tags.id)))
      .limit(limit);

    return tagCounts.map((tc) => ({ tag: tc.tag, count: tc.count }));
  }

  toJSON() {
    return {
      ...this.data,
      citations: this.citations,
      reviews: this.reviews,
      author: this.author,
      tags: this.tags,
    };
  }
}
