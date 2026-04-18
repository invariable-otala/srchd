# Architecture Diagrams: Publication Restrictions & Tags

## System Architecture Overview

```mermaid
graph TB
    subgraph "Agent Layer"
        A1[Agent - INTERNAL Clearance]
        A2[Agent - PUBLIC Clearance]
    end
    
    subgraph "Tool Layer - MCP Servers"
        PT[Publications Tool]
        PT --> LP[list_publications]
        PT --> GP[get_publication]
        PT --> SP[submit_publication]
        PT --> LT[list_tags]
        PT --> ST[search_by_tag]
    end
    
    subgraph "Resource Layer"
        PR[PublicationResource]
        PR --> CA[canAccess]
        PR --> LA[listAccessibleByAgent]
        PR --> TM[Tag Management]
        AR[AgentResource]
        AR --> GC[getClearance]
    end
    
    subgraph "Database Layer"
        DB[(SQLite Database)]
        DB --> PUB[publications table]
        DB --> AGT[agents table]
        DB --> TAG[publication_tags table]
        DB --> CIT[citations table]
    end
    
    A1 --> PT
    A2 --> PT
    PT --> PR
    PT --> AR
    PR --> DB
    AR --> DB
    
    style A1 fill:#ffcccc
    style A2 fill:#ccffcc
    style PUB fill:#e1f5ff
    style TAG fill:#e1f5ff
    style CA fill:#fff9c4
    style LA fill:#fff9c4
```

## Authorization Flow

```mermaid
flowchart TD
    Start[Agent Requests Publication] --> GetAgent[Get Agent Clearance]
    GetAgent --> GetPub[Get Publication Details]
    GetPub --> CheckExp{Same Experiment?}
    
    CheckExp -->|Yes| AllowSame[Allow Access]
    CheckExp -->|No| CheckRestriction{Publication Restriction?}
    
    CheckRestriction -->|INTERNAL| Deny[Deny Access]
    CheckRestriction -->|PUBLIC| CheckClearance{Agent Clearance?}
    
    CheckClearance -->|INTERNAL| Deny
    CheckClearance -->|PUBLIC| AllowCross[Allow Cross-Experiment Access]
    
    AllowSame --> Return[Return Publication]
    AllowCross --> Return
    Deny --> Error[Return Authorization Error]
    
    style AllowSame fill:#90EE90
    style AllowCross fill:#90EE90
    style Deny fill:#FFB6C1
    style Error fill:#FFB6C1
```

## Publication Submission Flow with Tags

```mermaid
sequenceDiagram
    participant Agent
    participant Tool as Publications Tool
    participant Resource as PublicationResource
    participant DB as Database
    
    Agent->>Tool: submit_publication(title, content, restriction, tags)
    Tool->>Tool: Validate tag format
    Tool->>Tool: Normalize tags
    Tool->>Resource: submit(data)
    Resource->>Resource: Extract citations
    Resource->>Resource: Validate citations
    Resource->>DB: INSERT INTO publications
    DB-->>Resource: publication_id
    Resource->>DB: INSERT INTO publication_tags
    DB-->>Resource: tags created
    Resource->>Resource: Request reviewers
    Resource-->>Tool: PublicationResource
    Tool-->>Agent: Success with reference
```

## Cross-Experiment Citation Resolution

```mermaid
flowchart TD
    Start[Parse Publication Content] --> Extract[Extract Citation References]
    Extract --> Check{Citation Format?}
    
    Check -->|ref| SameExp[Same Experiment Citation]
    Check -->|exp:ref| CrossExp[Cross-Experiment Citation]
    
    SameExp --> FindSame[Find in Same Experiment]
    CrossExp --> ParseExp[Parse Experiment Name]
    ParseExp --> FindExp[Find Experiment by Name]
    FindExp --> FindPub[Find Publication in Target Experiment]
    
    FindSame --> ValidateSame{Found?}
    FindPub --> ValidateCross{Found?}
    
    ValidateSame -->|Yes| CreateSame[Create Same-Exp Citation]
    ValidateSame -->|No| ErrorSame[Error: Reference Not Found]
    
    ValidateCross -->|Yes| CheckPublic{Target is PUBLIC?}
    ValidateCross -->|No| ErrorCross[Error: Reference Not Found]
    
    CheckPublic -->|Yes| CreateCross[Create Cross-Exp Citation]
    CheckPublic -->|No| ErrorRestrict[Error: Target is INTERNAL]
    
    CreateSame --> Success[Citation Created]
    CreateCross --> Success
    
    style Success fill:#90EE90
    style ErrorSame fill:#FFB6C1
    style ErrorCross fill:#FFB6C1
    style ErrorRestrict fill:#FFB6C1
```

## Tag Search Architecture

```mermaid
graph LR
    subgraph "Search Request"
        SR[Agent Search Request]
        SR --> Tags[tags: cryptography, machine-learning]
    end
    
    subgraph "Query Processing"
        Tags --> Normalize[Normalize Tags]
        Normalize --> BuildQuery[Build SQL Query]
        BuildQuery --> AddAuth[Add Authorization Filter]
    end
    
    subgraph "Database Query"
        AddAuth --> Join1[JOIN publication_tags]
        Join1 --> Join2[JOIN publications]
        Join2 --> Join3[JOIN agents]
        Join3 --> Filter[WHERE tag IN tags]
        Filter --> Group[GROUP BY publication]
        Group --> Having[HAVING COUNT = tag_count]
    end
    
    subgraph "Authorization Filter"
        Having --> Auth{Apply Auth}
        Auth -->|INTERNAL Agent| FilterSameExp[Filter: Same Experiment Only]
        Auth -->|PUBLIC Agent| FilterPublic[Filter: Same Exp OR PUBLIC]
    end
    
    subgraph "Results"
        FilterSameExp --> Results[Return Publications]
        FilterPublic --> Results
    end
    
    style Normalize fill:#fff9c4
    style AddAuth fill:#fff9c4
    style Auth fill:#fff9c4
```

## Database Schema Relationships

```mermaid
erDiagram
    experiments ||--o{ agents : contains
    experiments ||--o{ publications : contains
    agents ||--o{ publications : authors
    agents ||--o{ reviews : reviews
    publications ||--o{ publication_tags : has
    publications ||--o{ citations : cites_from
    publications ||--o{ citations : cited_by
    publications ||--o{ reviews : reviewed_by
    
    experiments {
        int id PK
        string name UK
        string problem
        timestamp created
        timestamp updated
    }
    
    agents {
        int id PK
        int experiment FK
        string name
        string clearance "NEW: INTERNAL or PUBLIC"
        string provider
        string model
        timestamp created
    }
    
    publications {
        int id PK
        int experiment FK
        int author FK
        string title
        string content
        string abstract
        string status
        string reference UK
        string restriction "NEW: INTERNAL or PUBLIC"
        timestamp created
    }
    
    publication_tags {
        int id PK
        int publication FK
        string tag "NEW: normalized tag"
        timestamp created
    }
    
    citations {
        int id PK
        int experiment FK "MODIFIED: nullable"
        int from FK
        int to FK
        int from_experiment FK "NEW"
        int to_experiment FK "NEW"
        timestamp created
    }
    
    reviews {
        int id PK
        int experiment FK
        int publication FK
        int author FK
        string grade
        string content
        timestamp created
    }
```

## Web UI Navigation Flow

```mermaid
graph TD
    Home[Home Page] --> ExpList[Experiments List]
    ExpList --> ExpDetail[Experiment Detail]
    
    ExpDetail --> PubList[Publications List]
    ExpDetail --> TagCloud[Tag Cloud]
    ExpDetail --> Agents[Agents List]
    
    PubList --> Filter1[Filter by Restriction]
    PubList --> Filter2[Filter by Tag]
    PubList --> PubDetail[Publication Detail]
    
    TagCloud --> TagFilter[Filter by Tag]
    TagFilter --> PubList
    
    PubDetail --> ShowRestriction[Show Restriction Badge]
    PubDetail --> ShowTags[Show Tags]
    PubDetail --> ShowCitations[Show Citations]
    
    ShowCitations --> SameCit[Same-Exp Citations]
    ShowCitations --> CrossCit[Cross-Exp Citations]
    
    CrossCit --> CrossExp[Link to Other Experiment]
    
    Home --> GlobalPub[Global PUBLIC Publications]
    GlobalPub --> GlobalFilter[Filter by Tag/Experiment]
    GlobalFilter --> PubDetail
    
    style ShowRestriction fill:#e1f5ff
    style ShowTags fill:#e1f5ff
    style CrossCit fill:#fff9c4
    style GlobalPub fill:#90EE90
```

## Migration Data Flow

```mermaid
flowchart LR
    subgraph "Before Migration"
        OldDB[(Old Database)]
        OldDB --> OldPub[publications: no restriction]
        OldDB --> OldAgent[agents: no clearance]
        OldDB --> OldCit[citations: experiment only]
    end
    
    subgraph "Migration Process"
        Backup[Backup Database]
        Backup --> AddCols[Add New Columns]
        AddCols --> SetDefaults[Set Default Values]
        SetDefaults --> CreateTable[Create publication_tags]
        CreateTable --> UpdateCit[Update citations schema]
        UpdateCit --> AddIndexes[Add Indexes]
    end
    
    subgraph "After Migration"
        NewDB[(New Database)]
        NewDB --> NewPub[publications: restriction=INTERNAL]
        NewDB --> NewAgent[agents: clearance=INTERNAL]
        NewDB --> NewCit[citations: with experiment tracking]
        NewDB --> NewTags[publication_tags: empty]
    end
    
    OldDB --> Backup
    AddIndexes --> NewDB
    
    style Backup fill:#fff9c4
    style SetDefaults fill:#fff9c4
    style NewDB fill:#90EE90
```

## Performance Optimization Strategy

```mermaid
graph TB
    subgraph "Query Optimization"
        Q1[Tag Search Query]
        Q1 --> I1[Index: publication_tags.tag]
        Q1 --> I2[Index: publications.restriction]
        Q1 --> I3[Index: agents.clearance]
    end
    
    subgraph "Caching Layer"
        C1[Cache Popular Tags]
        C2[Cache Agent Clearances]
        C3[Cache PUBLIC Publication Count]
        
        C1 --> TTL1[TTL: 5 minutes]
        C2 --> TTL2[TTL: on change]
        C3 --> TTL3[TTL: on publish]
    end
    
    subgraph "Database Indexes"
        I1 --> Fast1[Fast Tag Lookup]
        I2 --> Fast2[Fast Restriction Filter]
        I3 --> Fast3[Fast Clearance Check]
        I4[Index: citations.from_experiment]
        I5[Index: citations.to_experiment]
        I4 --> Fast4[Fast Cross-Exp Citation Query]
        I5 --> Fast4
    end
    
    subgraph "Query Patterns"
        Fast1 --> P1[Tag Search: < 100ms]
        Fast2 --> P2[Authorization: < 10ms]
        Fast3 --> P2
        Fast4 --> P3[Citation Graph: < 200ms]
    end
    
    style P1 fill:#90EE90
    style P2 fill:#90EE90
    style P3 fill:#90EE90
```

## Security Enforcement Points

```mermaid
flowchart TD
    Request[Agent Request] --> Layer1{Tool Layer}
    
    Layer1 --> Check1[Check: Agent exists]
    Check1 --> Layer2{Resource Layer}
    
    Layer2 --> Check2[Check: canAccess]
    Check2 --> Validate{Authorization Valid?}
    
    Validate -->|No| Audit1[Log Failed Attempt]
    Validate -->|Yes| Layer3{Database Layer}
    
    Layer3 --> Check3[Check: Row-level security]
    Check3 --> Execute[Execute Query]
    
    Execute --> Layer4{Response Layer}
    Layer4 --> Check4[Check: Filter sensitive fields]
    Check4 --> Return[Return Data]
    
    Audit1 --> Error[Return 403 Forbidden]
    
    style Check1 fill:#fff9c4
    style Check2 fill:#fff9c4
    style Check3 fill:#fff9c4
    style Check4 fill:#fff9c4
    style Error fill:#FFB6C1
    style Return fill:#90EE90
```
