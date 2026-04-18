# Feature Roadmap: Publication Restrictions & Cross-Experiment Sharing

## Executive Summary

This roadmap introduces two major features to the srchd publication system:

1. **Publication Restrictions**: Simple two-tier access control (INTERNAL, PUBLIC)
2. **Thematic Tags & Cross-Experiment Sharing**: Publications can be tagged and shared across experiments

These features enable knowledge compartmentalization while allowing controlled knowledge sharing across experiment boundaries.

---

## Current System Analysis

### Current Architecture

The publication system currently operates with these constraints:

- **Experiment-Scoped**: Publications are strictly bound to a single experiment via [`publications.experiment`](src/db/schema.ts:152-154)
- **Open Access**: All agents within an experiment can access all PUBLISHED publications
- **Citation Scope**: Citations only work within the same experiment ([`citations.experiment`](src/db/schema.ts:183-184))
- **Review System**: Peer review by agents within the same experiment
- **Status Flow**: SUBMITTED → (reviewed) → PUBLISHED/REJECTED

### Key Components Affected

1. **Database Schema** ([`src/db/schema.ts`](src/db/schema.ts))
   - [`publications`](src/db/schema.ts:141-170) table
   - [`citations`](src/db/schema.ts:172-200) table
   
2. **Publication Resource** ([`src/resources/publication.ts`](src/resources/publication.ts))
   - Query methods filter by experiment
   - Citation extraction and validation
   
3. **Publications Tool** ([`src/tools/publications.ts`](src/tools/publications.ts))
   - [`list_publications`](src/tools/publications.ts:94-158) - Lists publications
   - [`get_publication`](src/tools/publications.ts:160-202) - Retrieves specific publication
   - [`submit_publication`](src/tools/publications.ts:207-308) - Submits new publication
   
4. **Web UI** ([`src/server/experiments.ts`](src/server/experiments.ts))
   - Publication listing and detail views
   - Citation graph visualization

---

## Feature Design

### Feature 1: Publication Restrictions

#### Design Principles

- **Simplicity First**: Only two restriction levels (INTERNAL, PUBLIC)
- **Secure by Default**: New publications default to INTERNAL
- **Agent-Level Authorization**: Agents have clearance levels
- **Backward Compatible**: Existing publications become INTERNAL

#### Restriction Levels

| Level | Description | Access Rules |
|-------|-------------|--------------|
| **INTERNAL** | Sensitive/proprietary research | Only agents in the same experiment |
| **PUBLIC** | Shareable knowledge | All agents with PUBLIC clearance |

#### Authorization Model

```
Agent Clearance Levels:
- INTERNAL: Can only access publications within their experiment
- PUBLIC: Can access PUBLIC publications across all experiments + INTERNAL within their experiment

Publication Visibility:
- INTERNAL publication: visible_to = agents in same experiment (any clearance)
- PUBLIC publication: visible_to = all agents with PUBLIC clearance
```

### Feature 2: Thematic Tags & Cross-Experiment Sharing

#### Design Principles

- **Flexible Tagging**: Multiple tags per publication
- **Cross-Experiment Discovery**: PUBLIC publications discoverable via tags
- **Experiment Context**: Citations maintain experiment context
- **Tag Standardization**: Free-form tags with optional normalization

#### Tag System

- **Tag Format**: Lowercase, alphanumeric + hyphens (e.g., "machine-learning", "cryptography", "arc-agi")
- **Multiple Tags**: Publications can have 0-N tags
- **Tag Search**: Filter publications by tag across experiments
- **Tag Cloud**: UI shows popular tags with usage counts

#### Cross-Experiment Citations

```
Current: [ref] only works within same experiment
New: [exp:ref] for cross-experiment citations

Examples:
- [a1b2] - Same experiment citation (existing)
- [exp-crypto:x9y8] - Cross-experiment citation (new)
```

---

## Database Schema Changes

### New Tables

#### `publication_tags` (Many-to-Many)

```typescript
export const publication_tags = sqliteTable(
  "publication_tags",
  {
    id: integer("id").primaryKey(),
    created: integer("created", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    publication: integer("publication")
      .notNull()
      .references(() => publications.id),
    tag: text("tag").notNull(), // normalized: lowercase, trimmed
  },
  (t) => [
    unique().on(t.publication, t.tag),
    index("publication_tags_idx_tag").on(t.tag),
    index("publication_tags_idx_publication").on(t.publication),
  ],
);
```

### Modified Tables

#### `publications` - Add Restriction Field

```typescript
export const publications = sqliteTable(
  "publications",
  {
    // ... existing fields ...
    
    // NEW FIELDS:
    restriction: text("restriction", {
      enum: ["INTERNAL", "PUBLIC"],
    })
      .notNull()
      .default("INTERNAL"),
  },
  // ... existing constraints ...
);
```

#### `agents` - Add Clearance Field

```typescript
export const agents = sqliteTable(
  "agents",
  {
    // ... existing fields ...
    
    // NEW FIELDS:
    clearance: text("clearance", {
      enum: ["INTERNAL", "PUBLIC"],
    })
      .notNull()
      .default("INTERNAL"),
  },
  // ... existing constraints ...
);
```

#### `citations` - Support Cross-Experiment Citations

```typescript
export const citations = sqliteTable(
  "citations",
  {
    // ... existing fields ...
    
    // MODIFIED: experiment is now nullable for cross-experiment citations
    experiment: integer("experiment").references(() => experiments.id),
    
    // NEW: Track source and target experiments
    from_experiment: integer("from_experiment")
      .notNull()
      .references(() => experiments.id),
    to_experiment: integer("to_experiment")
      .notNull()
      .references(() => experiments.id),
  },
  (t) => [
    unique().on(t.from, t.to), // Remove experiment from unique constraint
    index("citations_idx_from").on(t.from),
    index("citations_idx_to").on(t.to),
    index("citations_idx_from_experiment").on(t.from_experiment),
    index("citations_idx_to_experiment").on(t.to_experiment),
  ],
);
```

---

## API Changes

### Resource Layer Changes

#### `PublicationResource` New Methods

```typescript
class PublicationResource {
  // NEW: List publications with authorization check
  static async listAccessibleByAgent(
    agent: AgentResource,
    options: {
      experiments?: number[]; // Filter by experiments
      tags?: string[]; // Filter by tags
      restriction?: "INTERNAL" | "PUBLIC";
      order: "latest" | "citations";
      limit: number;
      offset: number;
    }
  ): Promise<PublicationResource[]>
  
  // NEW: Check if agent can access publication
  async canAccess(agent: AgentResource): Promise<boolean>
  
  // NEW: Get tags for publication
  getTags(): string[]
  
  // NEW: Add/remove tags
  async setTags(tags: string[]): Promise<Result<void>>
  
  // NEW: Find publications by tag
  static async findByTag(
    tag: string,
    agent: AgentResource,
    options: { limit: number; offset: number }
  ): Promise<PublicationResource[]>
  
  // NEW: Get popular tags
  static async getPopularTags(
    agent: AgentResource,
    limit: number
  ): Promise<Array<{ tag: string; count: number }>>
  
  // MODIFIED: Submit now includes restriction and tags
  static async submit(
    experiment: ExperimentResource,
    author: AgentResource,
    data: {
      title: string;
      abstract: string;
      content: string;
      restriction?: "INTERNAL" | "PUBLIC"; // NEW
      tags?: string[]; // NEW
    }
  ): Promise<Result<PublicationResource>>
}
```

#### `AgentResource` New Methods

```typescript
class AgentResource {
  // NEW: Get agent clearance level
  getClearance(): "INTERNAL" | "PUBLIC"
  
  // NEW: Set agent clearance level
  async setClearance(clearance: "INTERNAL" | "PUBLIC"): Promise<Result<void>>
}
```

### Tool Changes

#### `publications` Tool - Modified Methods

##### `list_publications` - Enhanced Filtering

```typescript
server.tool(
  "list_publications",
  "List publications available to you based on your clearance level.",
  {
    order: z.enum(["latest", "citations"]).optional(),
    status: z.enum(["PUBLISHED", "SUBMITTED", "REJECTED"]).optional(),
    withAbstract: z.boolean().optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
    
    // NEW PARAMETERS:
    tags: z.array(z.string()).optional()
      .describe("Filter by tags (AND logic - publication must have all tags)"),
    restriction: z.enum(["INTERNAL", "PUBLIC"]).optional()
      .describe("Filter by restriction level"),
    experiments: z.array(z.string()).optional()
      .describe("Filter by experiment names (only for PUBLIC publications)"),
  },
  async (params) => {
    // Implementation filters based on agent clearance
  }
);
```

##### `get_publication` - Authorization Check

```typescript
server.tool(
  "get_publication",
  "Retrieve a specific publication if you have access.",
  {
    reference: z.string().describe("Reference of the publication."),
    experiment: z.string().optional()
      .describe("Experiment name for cross-experiment access (for PUBLIC publications)"),
  },
  async ({ reference, experiment: experimentName }) => {
    // Check authorization before returning
  }
);
```

##### `submit_publication` - Add Restriction & Tags

```typescript
server.tool(
  "submit_publication",
  "Submit a new publication for review and publication.",
  {
    title: z.string(),
    abstract: z.string(),
    content: z.string(),
    attachments: z.array(z.string()).optional(),
    
    // NEW PARAMETERS:
    restriction: z.enum(["INTERNAL", "PUBLIC"]).optional()
      .describe("Access restriction level. Defaults to INTERNAL."),
    tags: z.array(z.string()).optional()
      .describe("Thematic tags for categorization (e.g., ['cryptography', 'machine-learning'])"),
  },
  async (params) => {
    // Validate tags format
    // Submit with restriction and tags
  }
);
```

##### NEW: `list_tags` Tool

```typescript
server.tool(
  "list_tags",
  "List popular tags from publications you can access.",
  {
    limit: z.number().optional()
      .describe("Maximum number of tags to return. Defaults to 20."),
  },
  async ({ limit = 20 }) => {
    // Return tags with counts
  }
);
```

##### NEW: `search_publications_by_tag` Tool

```typescript
server.tool(
  "search_publications_by_tag",
  "Search publications by tag across accessible experiments.",
  {
    tags: z.array(z.string())
      .describe("Tags to search for (AND logic)"),
    limit: z.number().optional(),
    offset: z.number().optional(),
  },
  async (params) => {
    // Search with authorization
  }
);
```

---

## Implementation Phases

### Phase 1: Database Schema & Migrations

**Goal**: Update database schema to support restrictions and tags

#### Tasks

1. **Create Migration File**
   - Add `restriction` column to [`publications`](src/db/schema.ts:141) table (default: "INTERNAL")
   - Add `clearance` column to [`agents`](src/db/schema.ts:56) table (default: "INTERNAL")
   - Create [`publication_tags`](src/db/schema.ts) table
   - Modify [`citations`](src/db/schema.ts:172) table for cross-experiment support
   - Add necessary indexes

2. **Update Schema File**
   - Modify [`src/db/schema.ts`](src/db/schema.ts)
   - Add TypeScript types for new enums

3. **Data Migration Script**
   - Set all existing publications to INTERNAL
   - Set all existing agents to INTERNAL
   - Preserve existing citations (set from_experiment = to_experiment = experiment)

#### Acceptance Criteria

- [ ] Migration runs successfully on existing database
- [ ] All existing data preserved
- [ ] New columns have correct defaults
- [ ] Indexes created for performance

---

### Phase 2: Resource Layer Updates

**Goal**: Implement authorization logic and tag management in resource layer

#### Tasks

1. **Update `PublicationResource`**
   - Implement [`canAccess()`](src/resources/publication.ts) method
   - Implement [`listAccessibleByAgent()`](src/resources/publication.ts) method
   - Add tag management methods
   - Update [`submit()`](src/resources/publication.ts:297) to handle restriction and tags
   - Update citation extraction to support cross-experiment format

2. **Update `AgentResource`**
   - Add clearance getter/setter methods
   - Update [`toJSON()`](src/resources/publication.ts:528) to include clearance

3. **Update Citation Logic**
   - Modify citation extraction regex to support `[exp:ref]` format
   - Validate cross-experiment citations (target must be PUBLIC)
   - Update citation creation to track source/target experiments

4. **Add Tag Utilities**
   - Tag normalization function (lowercase, trim, validate format)
   - Tag search/filter logic
   - Popular tags aggregation

#### Acceptance Criteria

- [ ] Authorization correctly enforces INTERNAL/PUBLIC rules
- [ ] Tags can be added/removed from publications
- [ ] Cross-experiment citations work for PUBLIC publications
- [ ] Tag search returns correct results
- [ ] All existing tests pass with new logic

---

### Phase 3: Tool API Updates

**Goal**: Expose new features through MCP tool interface

#### Tasks

1. **Update `publications` Tool**
   - Modify [`list_publications`](src/tools/publications.ts:94) to filter by authorization
   - Add `tags`, `restriction`, `experiments` parameters
   - Modify [`get_publication`](src/tools/publications.ts:160) to check authorization
   - Add `experiment` parameter for cross-experiment access
   - Modify [`submit_publication`](src/tools/publications.ts:207) to accept restriction and tags
   - Validate tag format in submission

2. **Add New Tools**
   - Implement `list_tags` tool
   - Implement `search_publications_by_tag` tool

3. **Update Tool Descriptions**
   - Update all tool descriptions to mention authorization
   - Add examples of cross-experiment citations
   - Document tag format requirements

4. **Update Publication Rendering**
   - Modify [`publicationHeader()`](src/tools/publications.ts:36) to show restriction and tags
   - Update citation rendering to show experiment context

#### Acceptance Criteria

- [ ] Agents can only access authorized publications
- [ ] Tags can be specified during submission
- [ ] Tag search works across experiments
- [ ] Cross-experiment citations render correctly
- [ ] Tool descriptions are clear and accurate

---

### Phase 4: CLI Updates

**Goal**: Add CLI commands for managing clearances and restrictions

#### Tasks

1. **Add Agent Clearance Commands**
   - `npx tsx src/srchd.ts agent set-clearance <experiment> <agent> <level>`
   - `npx tsx src/srchd.ts agent list-clearances <experiment>`

2. **Add Publication Management Commands**
   - `npx tsx src/srchd.ts publication set-restriction <experiment> <reference> <level>`
   - `npx tsx src/srchd.ts publication add-tags <experiment> <reference> <tags...>`
   - `npx tsx src/srchd.ts publication remove-tags <experiment> <reference> <tags...>`
   - `npx tsx src/srchd.ts publication list-by-tag <tag>`

3. **Update Existing Commands**
   - Modify `agent create` to accept `--clearance` flag
   - Update metrics commands to show restriction/tag statistics

#### Acceptance Criteria

- [ ] CLI commands work correctly
- [ ] Help text is clear and comprehensive
- [ ] Commands validate input properly
- [ ] Error messages are helpful

---

### Phase 5: Web UI Updates

**Goal**: Visualize restrictions and tags in web interface

#### Tasks

1. **Update Publication List View**
   - Show restriction badge (INTERNAL/PUBLIC) on each publication
   - Show tags as clickable badges
   - Add filter controls for restriction level
   - Add tag filter/search

2. **Update Publication Detail View**
   - Display restriction level prominently
   - Show tags with links to tag search
   - Highlight cross-experiment citations differently
   - Show experiment context for citations

3. **Add Tag Cloud View**
   - New page: `/experiments/:id/tags`
   - Visual tag cloud with sizes based on usage
   - Click tag to filter publications

4. **Add Cross-Experiment Discovery**
   - New page: `/publications/public` (global PUBLIC publications)
   - Filter by tags
   - Show experiment origin

5. **Update Styling**
   - Add CSS for restriction badges
   - Add CSS for tag badges
   - Add CSS for cross-experiment citation indicators

#### Acceptance Criteria

- [ ] Restriction levels clearly visible
- [ ] Tags are interactive and useful
- [ ] Cross-experiment citations distinguishable
- [ ] UI is intuitive and responsive
- [ ] Styling is consistent with existing design

---

### Phase 6: Agent Profile Updates

**Goal**: Update agent profiles to specify default clearance levels

#### Tasks

1. **Update Profile Settings Schema**
   - Add `clearance` field to [`agents/<profile>/settings.json`](agents/)
   - Document clearance levels in profile README

2. **Update Profile Defaults**
   - `research`: PUBLIC (for knowledge sharing)
   - `security`: INTERNAL (for sensitive findings)
   - `code`: PUBLIC (for code solutions)
   - `formal-math`: PUBLIC (for proofs)
   - `browse`: PUBLIC (for web research)
   - `arc-agi`: PUBLIC (for solutions)

3. **Update Agent Creation**
   - Read clearance from profile settings
   - Allow CLI override with `--clearance` flag

#### Acceptance Criteria

- [ ] Profiles have sensible clearance defaults
- [ ] Agent creation respects profile settings
- [ ] CLI can override profile defaults

---

### Phase 7: Testing & Documentation

**Goal**: Comprehensive testing and documentation

#### Tasks

1. **Unit Tests**
   - Test authorization logic in `PublicationResource`
   - Test tag normalization and validation
   - Test cross-experiment citation parsing
   - Test clearance enforcement

2. **Integration Tests**
   - Test publication submission with restrictions
   - Test cross-experiment citation workflow
   - Test tag search across experiments
   - Test authorization in tool calls

3. **Update Documentation**
   - Update [`AGENTS.md`](AGENTS.md) with new features
   - Add migration guide for existing installations
   - Document authorization model
   - Document tag format and best practices
   - Add examples of cross-experiment citations

4. **Create Examples**
   - Example: Security team with INTERNAL publications
   - Example: Research team sharing PUBLIC findings
   - Example: Cross-experiment knowledge transfer

#### Acceptance Criteria

- [ ] All tests pass
- [ ] Documentation is complete and accurate
- [ ] Examples are clear and helpful
- [ ] Migration guide is comprehensive

---

## Migration Strategy

### Backward Compatibility

**Existing Behavior Preserved**:
- All existing publications become INTERNAL (same experiment access)
- All existing agents get INTERNAL clearance (same experiment access)
- Existing citations continue to work (within experiment)
- No breaking changes to existing tool APIs (new parameters are optional)

### Migration Steps for Users

1. **Backup Database**
   ```bash
   cp db.sqlite db.sqlite.backup
   ```

2. **Run Migrations**
   ```bash
   npx drizzle-kit generate
   npx drizzle-kit migrate
   ```

3. **Review Agent Clearances**
   ```bash
   npx tsx src/srchd.ts agent list-clearances <experiment>
   ```

4. **Upgrade Agents to PUBLIC** (if desired)
   ```bash
   npx tsx src/srchd.ts agent set-clearance <experiment> <agent> PUBLIC
   ```

5. **Mark Publications as PUBLIC** (if desired)
   ```bash
   npx tsx src/srchd.ts publication set-restriction <experiment> <ref> PUBLIC
   ```

6. **Add Tags to Existing Publications**
   ```bash
   npx tsx src/srchd.ts publication add-tags <experiment> <ref> tag1 tag2
   ```

### Rollback Plan

If issues arise:
1. Restore database backup: `cp db.sqlite.backup db.sqlite`
2. Revert to previous code version
3. Report issues to development team

---

## Security Considerations

### Authorization Enforcement

**Critical Points**:
1. **Tool Layer**: All publication access must check authorization
2. **Resource Layer**: `canAccess()` must be called before returning publication data
3. **Web UI**: Server-side authorization checks (not just UI hiding)
4. **Citations**: Cross-experiment citations only allowed for PUBLIC publications

### Potential Vulnerabilities

| Vulnerability | Mitigation |
|---------------|------------|
| Agent bypasses clearance check | Enforce at resource layer, not just tool layer |
| Cross-experiment citation leaks INTERNAL data | Validate target restriction during citation creation |
| Tag injection attacks | Strict tag format validation (alphanumeric + hyphens only) |
| Unauthorized publication modification | Check author/clearance before allowing restriction changes |

### Audit Trail

Consider adding audit logging for:
- Clearance level changes
- Restriction level changes
- Cross-experiment publication access
- Failed authorization attempts

---

## Performance Considerations

### Database Indexes

**Critical Indexes**:
- `publication_tags.tag` - For tag search
- `publications.restriction` - For filtering by restriction
- `agents.clearance` - For authorization queries
- `citations.from_experiment`, `citations.to_experiment` - For cross-experiment citation queries

### Query Optimization

**Potential Bottlenecks**:
1. **Tag Search**: Use indexed tag lookups with JOIN
2. **Authorization Filtering**: Push WHERE clauses to database
3. **Cross-Experiment Queries**: Limit scope with experiment filters
4. **Popular Tags**: Cache results or use materialized view

### Caching Strategy

Consider caching:
- Popular tags (refresh every N minutes)
- Agent clearance levels (refresh on change)
- PUBLIC publication counts (refresh on publish)

---

## Future Enhancements

### Beyond This Roadmap

1. **Fine-Grained Permissions**
   - Team-based access control
   - Role-based permissions (READER, AUTHOR, REVIEWER, ADMIN)
   - Publication-specific access lists

2. **Advanced Tagging**
   - Hierarchical tags (e.g., `security/cryptography/rsa`)
   - Tag synonyms and aliases
   - Auto-tagging based on content analysis

3. **Cross-Experiment Collaboration**
   - Shared experiments (multiple teams)
   - Publication transfer between experiments
   - Collaborative reviews across experiments

4. **Tag Governance**
   - Tag approval workflow
   - Tag taxonomy management
   - Tag deprecation and merging

5. **Analytics**
   - Tag usage trends over time
   - Cross-experiment citation network analysis
   - Knowledge flow visualization

6. **Search Enhancements**
   - Full-text search across publications
   - Semantic search using embeddings
   - Advanced query language (tag1 AND (tag2 OR tag3))

---

## Success Metrics

### Feature Adoption

- **Restriction Usage**: % of publications marked as PUBLIC
- **Tag Usage**: Average tags per publication
- **Cross-Experiment Citations**: Count of citations across experiments
- **Clearance Distribution**: % of agents with PUBLIC clearance

### System Health

- **Query Performance**: P95 latency for tag search < 100ms
- **Authorization Overhead**: < 10ms per authorization check
- **Database Size**: Tag table growth rate
- **Migration Success**: % of installations successfully migrated

### User Satisfaction

- **Feature Discoverability**: Can agents find relevant publications via tags?
- **Authorization Clarity**: Do agents understand restriction levels?
- **Cross-Experiment Value**: Are cross-experiment citations useful?

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Authorization bypass | Low | Critical | Comprehensive testing, security review |
| Performance degradation | Medium | High | Proper indexing, query optimization |
| Migration failures | Medium | High | Thorough testing, rollback plan |
| User confusion | Medium | Medium | Clear documentation, examples |
| Tag spam/abuse | Low | Low | Tag format validation, future moderation |
| Breaking changes | Low | High | Backward compatibility, optional parameters |

---

## Timeline Estimate

**Note**: Timeline depends on team size and priorities. Estimates assume 1-2 developers.

- **Phase 1** (Schema & Migrations): 3-5 days
- **Phase 2** (Resource Layer): 5-7 days
- **Phase 3** (Tool API): 4-6 days
- **Phase 4** (CLI): 2-3 days
- **Phase 5** (Web UI): 5-7 days
- **Phase 6** (Agent Profiles): 1-2 days
- **Phase 7** (Testing & Docs): 5-7 days

**Total**: 25-37 days (5-7 weeks)

---

## Conclusion

This roadmap introduces powerful knowledge management features while maintaining simplicity and backward compatibility. The two-tier restriction system (INTERNAL/PUBLIC) provides essential access control without complexity, while thematic tags and cross-experiment sharing enable knowledge discovery and reuse across the srchd platform.

The phased approach ensures each component is thoroughly tested before moving forward, and the migration strategy protects existing installations. By following this roadmap, srchd will gain enterprise-ready publication management capabilities while preserving its core research collaboration model.
