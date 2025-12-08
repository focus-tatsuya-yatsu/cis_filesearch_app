# Visual Learning Path - CIS File Search Application

**🎯 Purpose**: Visual guide to understanding AWS services and their relationships

**👁️ For**: Visual learners who need to see the big picture

---

## 🎨 The Complete System Map

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  YOUR JOURNEY: From Files on NAS → Searchable in Cloud                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

WEEK 1: FOUNDATION                    WEEK 2: PROCESSING
┌────────────────────┐                ┌────────────────────┐
│                    │                │                    │
│   Session 1-2:     │                │   Session 4:       │
│   ┌──────────┐     │                │   ┌──────────┐     │
│   │   IAM    │     │                │   │OpenSearch│     │
│   │  Roles   │     │                │   │  Domain  │     │
│   └──────────┘     │                │   └──────────┘     │
│         ↓          │                │         ↑          │
│   ┌──────────┐     │                │         │          │
│   │    S3    │─────┼────────────────┼─────────┘          │
│   │  Bucket  │     │  Session 5:    │                    │
│   └──────────┘     │  EventBridge   │   Session 6:       │
│         ↓          │                │   ┌──────────┐     │
│   Session 3:       │                │   │   Auto   │     │
│   ┌──────────┐     │                │   │ Scaling  │     │
│   │   SQS    │─────┼────────────────┼───│  Group   │     │
│   │  Queue   │     │                │   └──────────┘     │
│   └──────────┘     │                │         │          │
│                    │                │         ↓          │
└────────────────────┘                └────────┬───────────┘
                                               │
WEEK 3: OPTIMIZATION                           │
┌────────────────────┐                        │
│                    │                        │
│   Session 7:       │                        │
│   ┌──────────┐     │                        │
│   │   VPC    │     │                        │
│   │Endpoints │←────┼────────────────────────┘
│   └──────────┘     │
│                    │
│   Session 8:       │
│   ┌──────────┐     │
│   │CloudWatch│     │
│   │Monitoring│     │
│   └──────────┘     │
│                    │
└────────────────────┘
```

---

## 🌊 Data Flow: Following a File's Journey

### Step 1: File Upload (S3)
```
📁 Contract.pdf (Local NAS)
         │
         │ DataSync
         ↓
┌─────────────────────┐
│  S3 Bucket          │
│  └─ files/          │
│     └─ contracts/   │
│        └─ Contract  │
│           .pdf      │
└─────────────────────┘
         │
         │ 🔔 "New file!" event
         ↓
```

**What happens**: File automatically uploads to cloud storage
**Your role**: Configure S3 bucket with correct permissions
**Session**: 1

---

### Step 2: Event Detection (EventBridge)
```
┌─────────────────────┐
│  S3 sends event:    │
│  {                  │
│    "bucket": "...", │
│    "key": "contrac  │
│            t.pdf",  │
│    "size": "2.5MB"  │
│  }                  │
└─────────────────────┘
         │
         │ EventBridge Rule
         │ IF: s3:ObjectCreated
         │ THEN: Send to SQS
         ↓
```

**What happens**: AWS detects file arrival automatically
**Your role**: Create EventBridge rule to route events
**Session**: 5

---

### Step 3: Queue Message (SQS)
```
┌─────────────────────┐
│  SQS Queue          │
│                     │
│  [📝 Message 1]     │ ← Contract.pdf
│  [📝 Message 2]     │
│  [📝 Message 3]     │
│  [📝 Message 4]     │
│                     │
│  Waiting: 4 files   │
└─────────────────────┘
         │
         │ Workers poll queue
         ↓
```

**What happens**: Messages wait in line for processing
**Your role**: Configure queue with retry logic
**Session**: 3

---

### Step 4: Auto Scaling (EC2)
```
┌─────────────────────┐
│  Auto Scaling sees: │
│  Queue depth: 100   │
│  Target: 30 per     │
│          instance   │
│  Need: 4 instances  │
└─────────────────────┘
         │
         │ Launch instances
         ↓
┌─────────────────────┐
│  Worker Instances   │
│                     │
│  [EC2] [EC2]       │ ← Processing files
│  [EC2] [EC2]       │
│                     │
└─────────────────────┘
         │
         │ Each worker:
         │ 1. Get message
         │ 2. Download file
         │ 3. Extract text
         │ 4. Create thumbnail
         │ 5. Get AI embeddings
         ↓
```

**What happens**: More files = More workers (automatically!)
**Your role**: Configure auto scaling rules
**Session**: 6

---

### Step 5: Indexing (OpenSearch)
```
┌─────────────────────┐
│  Worker sends to    │
│  OpenSearch:        │
│  {                  │
│    "filename": "C", │
│    "content": "Th", │
│    "thumbnail": "b64│
│    "embedding": [0  │
│  }                  │
└─────────────────────┘
         │
         ↓
┌─────────────────────┐
│  OpenSearch Index   │
│                     │
│  📄 Contract.pdf    │
│  📄 Proposal.docx   │
│  📄 Invoice.xlsx    │
│  📄 Report.pdf      │
│  ...                │
│  (Searchable!)      │
└─────────────────────┘
```

**What happens**: File is now searchable in < 1 second!
**Your role**: Set up OpenSearch domain
**Session**: 4

---

### Step 6: Search (User Query)
```
User types: "ABC Company contract 2023"
         │
         ↓
┌─────────────────────┐
│  OpenSearch Query   │
│                     │
│  Analyzing:         │
│  - "ABC" in content │
│  - "Company" in name│
│  - "2023" in date   │
│  - "contract" in typ│
└─────────────────────┘
         │
         │ 0.2 seconds
         ↓
┌─────────────────────┐
│  Results:           │
│                     │
│  1. ABC_Master_Ag   │
│     2023.pdf (98%)  │
│  2. ABC_Amendment   │
│     2024.pdf (87%)  │
│  3. ABC_Proposal    │
│     Draft.docx (76%)│
└─────────────────────┘
```

**What happens**: Users find files instantly
**Your role**: Build search UI (later phase)

---

## 🏗️ Architecture Layers

### Layer 1: Entry Point (The Door)
```
┌──────────────────────────────────────┐
│  S3 BUCKET                           │
│  "The front door where files enter"  │
│                                      │
│  Purpose: Receive and store files    │
│  Size: Unlimited                     │
│  Cost: $15/month for 1TB            │
└──────────────────────────────────────┘

🔧 Session 1: Create bucket
🔒 Session 2: Secure with IAM policies
```

---

### Layer 2: Message Queue (The Clipboard)
```
┌──────────────────────────────────────┐
│  SQS QUEUE                           │
│  "To-do list of files to process"    │
│                                      │
│  Purpose: Track work reliably        │
│  Capacity: Unlimited messages        │
│  Cost: Free (under 1M requests/mo)   │
└──────────────────────────────────────┘

🔧 Session 3: Create queue + DLQ
📊 Session 6: Connect to Auto Scaling
```

---

### Layer 3: Workers (The Team)
```
┌──────────────────────────────────────┐
│  AUTO SCALING GROUP                  │
│  "Flexible team that grows/shrinks"  │
│                                      │
│  Purpose: Process files in parallel  │
│  Capacity: 0 to 10 instances         │
│  Cost: $9/month (Spot instances)     │
└──────────────────────────────────────┘

🔧 Session 6: Configure scaling rules
💰 Session 7: Optimize with Spot instances
```

---

### Layer 4: Search Engine (The Library)
```
┌──────────────────────────────────────┐
│  OPENSEARCH DOMAIN                   │
│  "Searchable index of all files"     │
│                                      │
│  Purpose: Fast full-text search      │
│  Capacity: Millions of documents     │
│  Cost: $48/month (t3.small)         │
└──────────────────────────────────────┘

🔧 Session 4: Deploy domain
🔍 Session 4: Create first index
```

---

### Layer 5: Monitoring (The Control Room)
```
┌──────────────────────────────────────┐
│  CLOUDWATCH                          │
│  "Dashboard showing system health"   │
│                                      │
│  Purpose: Monitor and alert          │
│  Features: Logs, Metrics, Alarms     │
│  Cost: $2/month                      │
└──────────────────────────────────────┘

🔧 Session 8: Set up logging
📊 Session 8: Create dashboard
```

---

## 🎓 Concept Progression

### Week 1: Understanding Cloud Storage

```
Day 1: What is S3?
┌─────────────────────────────────────────────┐
│                                             │
│  Think of S3 like:                          │
│  - Google Drive (but for servers)           │
│  - Unlimited Dropbox                        │
│  - Virtual hard drive in the cloud          │
│                                             │
│  Key concepts:                              │
│  ✓ Bucket = Folder (top level)             │
│  ✓ Object = File                            │
│  ✓ Key = File path                          │
│                                             │
└─────────────────────────────────────────────┘
```

```
Day 2: What is IAM?
┌─────────────────────────────────────────────┐
│                                             │
│  Think of IAM like:                         │
│  - Badge system in office building          │
│  - Keys that open specific doors            │
│  - Permission slips for resources           │
│                                             │
│  Key concepts:                              │
│  ✓ User = Person                            │
│  ✓ Role = Job title with permissions        │
│  ✓ Policy = List of allowed actions         │
│                                             │
└─────────────────────────────────────────────┘
```

```
Day 3: What is SQS?
┌─────────────────────────────────────────────┐
│                                             │
│  Think of SQS like:                         │
│  - Ticket queue at deli counter             │
│  - TO-DO app with automatic retries         │
│  - Email inbox that workers check           │
│                                             │
│  Key concepts:                              │
│  ✓ Message = Work item                      │
│  ✓ Visibility timeout = "I'm working on it" │
│  ✓ DLQ = Failed tasks go here              │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Week 2: Understanding Processing

```
Day 1: What is OpenSearch?
┌─────────────────────────────────────────────┐
│                                             │
│  Think of OpenSearch like:                  │
│  - Google search for your files             │
│  - Super-fast library card catalog          │
│  - Index at back of book (but searchable)   │
│                                             │
│  Key concepts:                              │
│  ✓ Index = Database of searchable docs      │
│  ✓ Document = One file's metadata           │
│  ✓ Query = Search terms                     │
│  ✓ k-NN = Find similar images               │
│                                             │
└─────────────────────────────────────────────┘
```

```
Day 2: What is EventBridge?
┌─────────────────────────────────────────────┐
│                                             │
│  Think of EventBridge like:                 │
│  - Email filter rules                       │
│  - IFTTT for AWS services                   │
│  - Automatic notification system            │
│                                             │
│  Key concepts:                              │
│  ✓ Event = Something happened (file upload) │
│  ✓ Rule = IF this, THEN that                │
│  ✓ Target = Where to send event (SQS)       │
│                                             │
└─────────────────────────────────────────────┘
```

```
Day 3: What is Auto Scaling?
┌─────────────────────────────────────────────┐
│                                             │
│  Think of Auto Scaling like:                │
│  - Restaurant adding servers during rush    │
│  - Uber surge pricing (more drivers)        │
│  - Elastic waistband (expands as needed)    │
│                                             │
│  Key concepts:                              │
│  ✓ Launch Template = Recipe for EC2         │
│  ✓ Scaling Policy = When to add/remove      │
│  ✓ Desired Capacity = How many right now    │
│  ✓ Spot Instance = Cheap, temporary servers │
│                                             │
└─────────────────────────────────────────────┘
```

---

### Week 3: Understanding Optimization

```
Day 1: What are VPC Endpoints?
┌─────────────────────────────────────────────┐
│                                             │
│  Think of VPC Endpoints like:               │
│  - Private hallway between offices          │
│  - Direct tunnel instead of using highway   │
│  - Shortcut that saves money                │
│                                             │
│  Why it matters:                            │
│  Without: $45/month (NAT Gateway costs)     │
│  With: $7/month (VPC endpoint costs)        │
│  Savings: $38/month!                        │
│                                             │
│  Key concepts:                              │
│  ✓ Gateway Endpoint = Free (S3)             │
│  ✓ Interface Endpoint = $7/mo (SQS)         │
│  ✓ Private network = No internet needed     │
│                                             │
└─────────────────────────────────────────────┘
```

```
Day 2: What is CloudWatch?
┌─────────────────────────────────────────────┐
│                                             │
│  Think of CloudWatch like:                  │
│  - Car dashboard (speed, fuel, temp)        │
│  - Fitbit for your AWS infrastructure       │
│  - Security camera recording                │
│                                             │
│  Key concepts:                              │
│  ✓ Logs = Text records of what happened     │
│  ✓ Metrics = Numbers (CPU, memory, etc.)    │
│  ✓ Alarms = Alert when something wrong      │
│  ✓ Dashboard = Visual overview              │
│                                             │
└─────────────────────────────────────────────┘
```

---

## 📊 Complexity Levels

### 🟢 Easy Services (Week 1)
```
S3:           ████████░░ 80% intuitive
              "Just a cloud folder"

SQS:          ███████░░░ 70% intuitive
              "Just a to-do list"

EventBridge:  ██████░░░░ 60% intuitive
              "Email filters for AWS"
```

### 🟡 Medium Services (Week 2)
```
IAM:          ████░░░░░░ 40% intuitive
              "Security is complex"

OpenSearch:   ███░░░░░░░ 30% intuitive
              "Search engines are tricky"
```

### 🔴 Hard Services (Week 2-3)
```
Auto Scaling: ██░░░░░░░░ 20% intuitive
              "Many moving parts"

VPC:          █░░░░░░░░░ 10% intuitive
              "Networking is hard"
```

**💡 Pro Tip**: This is NORMAL! Even experts find VPC confusing. Follow the guides step-by-step.

---

## 🎯 Decision Trees

### "Which instance type should I use?"

```
How many files per month?
│
├─ < 10,000 files
│  └─ t3.small.search (OpenSearch)
│     t3.medium (EC2 workers)
│
├─ 10,000 - 100,000 files
│  └─ t3.medium.search (OpenSearch)
│     t3.large (EC2 workers)
│
└─ > 100,000 files
   └─ r6g.large.search (OpenSearch)
      c6g.xlarge (EC2 workers)
```

### "How many workers do I need?"

```
Processing speed needed?
│
├─ Real-time (< 1 minute)
│  └─ Max instances: 10
│     Target: 10 messages per instance
│
├─ Fast (< 5 minutes)
│  └─ Max instances: 5
│     Target: 20 messages per instance
│
└─ Batch (< 1 hour)
   └─ Max instances: 3
      Target: 50 messages per instance
```

### "When should I scale down?"

```
Queue depth?
│
├─ 0 messages for 10 minutes
│  └─ Scale to 0 instances (save money!)
│
├─ < 30 messages
│  └─ Scale to 1 instance
│
└─ > 30 messages
   └─ Keep scaling up
```

---

## 🗺️ Mental Model: The Restaurant Analogy

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  AWS Service = Restaurant Department                   │
│                                                         │
│  S3 Bucket        = Walk-in Freezer (stores ingredients)│
│  SQS Queue        = Order tickets (pending orders)      │
│  EventBridge      = Doorbell (alerts when order comes)  │
│  Auto Scaling     = Hiring more cooks during rush       │
│  OpenSearch       = Recipe book (search for dishes)     │
│  CloudWatch       = Manager watching cameras            │
│  IAM              = Employee badges (access control)    │
│  VPC Endpoints    = Kitchen back door (private access)  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**The Flow**:
1. Customer orders (upload file to S3)
2. Doorbell rings (EventBridge event)
3. Order ticket printed (SQS message)
4. Cook takes ticket (EC2 worker processes)
5. Manager checks camera (CloudWatch logs)
6. Food served (file indexed in OpenSearch)

---

## 🎨 Color-Coded Service Categories

### 🔵 Storage Services
- **S3**: Object storage (files)
- **EBS**: Block storage (EC2 disk drives)

### 🟢 Compute Services
- **EC2**: Virtual servers
- **Auto Scaling**: Dynamic server management

### 🟡 Networking Services
- **VPC**: Private network
- **VPC Endpoints**: Private connections

### 🟠 Application Integration
- **SQS**: Message queue
- **EventBridge**: Event routing

### 🔴 Analytics & Search
- **OpenSearch**: Search engine
- **CloudWatch**: Logging and monitoring

### 🟣 Security Services
- **IAM**: Access control
- **Secrets Manager**: Credential storage

---

**Document Version**: 1.0
**Last Updated**: 2025-01-18

**Print this and put it on your wall!** 🖼️

Visual learning works best when you can **see** the whole system at once.
