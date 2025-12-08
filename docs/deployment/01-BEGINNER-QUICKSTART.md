# Beginner's Quickstart Guide - CIS File Search Application

**🎯 Goal**: Get you from zero AWS knowledge to a running file search system

**⏱️ Time**: 2-3 hours for this guide, then 10-15 hours for full setup

**👤 For**: Complete AWS beginners, first-time cloud deployers

---

## 📖 Table of Contents

1. [What You're Building](#what-youre-building)
2. [Before You Start](#before-you-start)
3. [AWS Account Setup](#aws-account-setup)
4. [Understanding the Architecture](#understanding-the-architecture)
5. [Your First Session (2 hours)](#your-first-session-2-hours)
6. [Next Steps](#next-steps)

---

## 🏗️ What You're Building

### The Big Picture

You're building a **file search system** that can:
- Scan files on your company's local network (NAS)
- Upload them to the cloud (AWS S3)
- Extract text and metadata automatically
- Make everything searchable (like Google, but for your files)
- Find similar images using AI

### Real-World Example

**Before** (Manual process):
```
User: "Where's the contract from ABC Company?"
You: *Spends 30 minutes searching folders manually*
     "Found it! It was in /Legal/2023/Q2/Contracts/..."
```

**After** (With this system):
```
User: "Where's the contract from ABC Company?"
System: *Search takes 0.3 seconds*
        "Found 3 results:
         1. ABC_Master_Agreement_2023.pdf (Legal/2023/Q2/)
         2. ABC_Amendment_2024.pdf (Legal/2024/Q1/)
         3. ABC_Proposal_Draft.docx (Sales/2023/)"
```

### What Makes This System Special?

1. **Automatic**: Files upload to cloud automatically
2. **Scalable**: Handles 10 files or 10 million files
3. **Cost-Optimized**: Uses AWS Spot Instances (70% cheaper than regular servers)
4. **Secure**: Enterprise-grade encryption and access controls
5. **Smart**: AI-powered image similarity search

---

## 🧰 Before You Start

### Prerequisites Checklist

**Required**:
- [ ] Computer with internet connection (Windows, Mac, or Linux)
- [ ] Credit card (for AWS account - you'll spend ~$100/month)
- [ ] Email address
- [ ] Phone number (for SMS verification)
- [ ] 2-3 hours of focused time

**Helpful (but not required)**:
- [ ] Basic understanding of files and folders
- [ ] Comfort with copy-pasting commands
- [ ] Willingness to learn new concepts

### What You DON'T Need

- ❌ Programming experience (we provide all code)
- ❌ Server management experience (AWS handles that)
- ❌ Networking expertise (we'll explain everything)
- ❌ Prior cloud experience (this guide assumes zero knowledge)

### Expected Costs

**Setup Phase** (first month):
- AWS services: ~$86-120/month
- Learning/testing: ~$20-30 extra (deleted after testing)

**Ongoing** (monthly):
- Production system: ~$86/month
- Can be reduced to ~$50/month with optimizations

**Cost Breakdown**:
```
OpenSearch (search engine):     $48/month
S3 Storage (1TB files):         $15/month
EC2 Spot Instances (processors):  $9/month
VPC Endpoints (networking):       $8/month
CloudWatch (monitoring):          $2/month
Other services:                   $4/month
─────────────────────────────────────────
Total:                          ~$86/month
```

**💡 Tip**: Start with the dev environment first. It's identical to production but uses smaller resources (~$40/month).

---

## 🎫 AWS Account Setup

### Step 1: Create AWS Account (20 minutes)

**1.1. Go to AWS**:
- Open browser to: https://aws.amazon.com
- Click **"Create an AWS Account"**

**1.2. Fill in details**:
```
Email: your-email@company.com
Account name: CIS File Search Dev
              ↑ Use something descriptive
```

**1.3. Contact information**:
```
Account type: Business (or Professional)
              ↑ Doesn't matter much for dev

Full name: Your Name
Phone: Your phone number (for SMS verification)
Address: Your business address
```

**1.4. Payment information**:
- Add credit card
- Don't worry: AWS has a free tier, and you'll get email alerts before charges

**1.5. Identity verification**:
- AWS will call or text you
- Enter the 4-digit code they provide

**1.6. Select support plan**:
- Choose: **Basic Support (Free)**
- You can upgrade later if needed

**1.7. Complete**:
- You'll see "Congratulations!" screen
- Check email for confirmation

**⏱️ Wait time**: 5-10 minutes for account activation

---

### Step 2: Secure Your Account (15 minutes)

**🚨 CRITICAL**: Your AWS account has access to your credit card. Secure it NOW!

**2.1. Enable MFA (Multi-Factor Authentication)**:

1. Sign in to AWS Console: https://console.aws.amazon.com
2. Click your account name (top-right) → **Security Credentials**
3. Find **"Multi-factor authentication (MFA)"**
4. Click **"Assign MFA device"**
5. Choose:
   - **Virtual MFA device** (recommended - use phone app)
   - Options: Google Authenticator, Authy, Microsoft Authenticator
6. Scan QR code with your phone app
7. Enter two consecutive MFA codes
8. Click **"Assign MFA"**

**✅ Verification**: Log out and back in. You should be prompted for MFA code.

**2.2. Set up billing alerts**:

1. Click account name → **Billing Dashboard**
2. Left menu → **Budgets** → **Create budget**
3. Use template: **"Monthly cost budget"**
4. Budget amount: **$150** (gives buffer for testing)
5. Email: Your email
6. Create budget

**✅ Verification**: You'll get email confirmation of budget alert setup.

---

### Step 3: Install AWS CLI (30 minutes)

The AWS CLI (Command Line Interface) lets you control AWS from your terminal. It's faster than clicking through the web console.

**3.1. Install AWS CLI**:

**macOS**:
```bash
# Using Homebrew (recommended)
brew install awscli

# Verify installation
aws --version
# Should show: aws-cli/2.x.x Python/3.x.x Darwin/xx.x.x
```

**Windows**:
```powershell
# Download installer from:
https://awscli.amazonaws.com/AWSCLIV2.msi

# Run installer (double-click downloaded file)

# Verify installation (open new PowerShell)
aws --version
```

**Linux**:
```bash
# Download and install
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Verify installation
aws --version
```

**3.2. Create IAM user for CLI access**:

**Why?** Root account (what you just created) is too powerful for daily use. Create a separate user for safety.

1. AWS Console → Search "IAM" → Click **IAM**
2. Left menu → **Users** → **Add users**
3. User name: `cis-admin`
4. Select: **Provide user access to the AWS Management Console** (optional)
5. Select: **I want to create an IAM user**
6. Console password: Choose **Custom password**, enter strong password
7. Uncheck: **"Users must create a new password at next sign-in"**
8. Click **Next**
9. Permissions: **Attach policies directly**
10. Search and select: `AdministratorAccess` (for now - we'll restrict later)
11. Click **Next** → **Create user**

**3.3. Create access keys**:

1. Click the user you just created (`cis-admin`)
2. Tab: **Security credentials**
3. Scroll to **Access keys** → **Create access key**
4. Use case: **Command Line Interface (CLI)**
5. Check: **"I understand the above recommendation..."**
6. Click **Next** → **Create access key**
7. **IMPORTANT**: Copy both:
   - Access key ID (looks like: `AKIAIOSFODNN7EXAMPLE`)
   - Secret access key (looks like: `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`)
   - **⚠️ You'll never see the secret key again!** Download CSV or save to password manager

**3.4. Configure AWS CLI**:

```bash
aws configure

# You'll be prompted for:
AWS Access Key ID [None]: AKIAIOSFODNN7EXAMPLE
AWS Secret Access Key [None]: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
Default region name [None]: ap-northeast-1
Default output format [None]: json
```

**Region explanation**:
- `ap-northeast-1` = Tokyo, Japan
- Use Tokyo if you're in Asia
- Use `us-east-1` (Virginia) if in North America
- Use `eu-west-1` (Ireland) if in Europe

**3.5. Verify configuration**:

```bash
# Check your identity
aws sts get-caller-identity

# Should show:
{
    "UserId": "AIDAIO...",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/cis-admin"
}
```

**✅ Success**: If you see account info, AWS CLI is working!

---

### Step 4: Install Helper Tools (15 minutes)

**4.1. Install jq (JSON parser)**:

**macOS**:
```bash
brew install jq
```

**Windows**:
```powershell
# Download from: https://jqlang.github.io/jq/download/
# Or use Chocolatey:
choco install jq
```

**Linux**:
```bash
sudo apt-get install jq   # Ubuntu/Debian
sudo yum install jq       # CentOS/RHEL
```

**Verify**:
```bash
echo '{"name":"test"}' | jq .
# Should output formatted JSON
```

**4.2. Install text editor** (if you don't have one):

**Options**:
- Visual Studio Code (recommended): https://code.visualstudio.com
- Sublime Text: https://www.sublimetext.com
- Or use built-in: Notepad (Windows), TextEdit (Mac), nano/vim (Linux)

---

## 🏛️ Understanding the Architecture

### The Simple Explanation

Think of the system like a factory assembly line:

```
1. SCANNER PC (Your computer)
   └─ Scans files on local network
   └─ Uploads to "Landing Zone" (S3 bucket)

2. LANDING ZONE (S3 bucket)
   └─ Stores files temporarily
   └─ Triggers notification "New file arrived!"

3. MESSAGE QUEUE (SQS)
   └─ Holds list of files to process
   └─ Like a to-do list

4. WORKERS (EC2 instances)
   └─ Take files from to-do list
   └─ Extract text, metadata, thumbnails
   └─ Auto-scale: More files = More workers

5. SEARCH ENGINE (OpenSearch)
   └─ Stores searchable index
   └─ Handles search queries from users
```

### The Technical Diagram

```
┌─────────────────┐
│  Windows PC     │ DataSync Agent
│  (Scanner)      │────────────────┐
└─────────────────┘                │
                                   ▼
                         ┌─────────────────┐
                         │  S3 Bucket      │
                         │  (Landing Zone) │
                         └────────┬────────┘
                                  │ S3 Event
                                  ▼
                         ┌─────────────────┐
                         │  EventBridge    │
                         │  (Event Router) │
                         └────────┬────────┘
                                  │
                                  ▼
                         ┌─────────────────┐
                         │  SQS Queue      │
                         │  (To-Do List)   │
                         └────────┬────────┘
                                  │ Poll messages
                                  ▼
                    ┌──────────────────────────┐
                    │  Auto Scaling Group      │
                    │  ┌────┐ ┌────┐ ┌────┐   │
                    │  │EC2 │ │EC2 │ │EC2 │   │
                    │  └────┘ └────┘ └────┘   │
                    └──────┬──────────┬────────┘
                           │          │
           ┌───────────────┘          └──────────────┐
           ▼                                         ▼
  ┌─────────────────┐                    ┌─────────────────┐
  │  OpenSearch     │                    │  Bedrock Titan  │
  │  (Full-text     │                    │  (Image AI)     │
  │   search)       │                    │                 │
  └─────────────────┘                    └─────────────────┘
```

### Key Concepts Explained

**S3 (Simple Storage Service)**:
- Like Google Drive or Dropbox
- Unlimited storage (you pay per GB)
- 99.999999999% durability (won't lose your files)

**SQS (Simple Queue Service)**:
- Like a to-do list or ticket system
- Ensures no file is forgotten
- Handles retries if processing fails

**EC2 (Elastic Compute Cloud)**:
- Virtual servers in the cloud
- Auto Scaling = Automatically add/remove servers based on workload
- Spot Instances = Unused capacity AWS sells cheap (70% discount!)

**OpenSearch**:
- Search engine (like Google search for your files)
- Handles millions of documents
- Sub-second search results

**EventBridge**:
- Event router (like an email filter)
- "When file uploaded to S3, send message to SQS"

---

## 🚀 Your First Session (2 hours)

Let's get hands-on! We'll create your first S3 bucket and test it.

### Session Goal

By the end, you'll:
- Have a working S3 bucket
- Successfully upload a file via CLI
- Understand AWS Console navigation

---

### Part 1: Create Your First S3 Bucket (30 min)

**1. Open AWS Console**:
- Go to: https://console.aws.amazon.com
- Sign in as the IAM user you created (`cis-admin`)

**2. Navigate to S3**:
- Top search bar → Type "S3" → Click **S3**
- You'll see: "Buckets" page (probably empty)

**3. Create bucket**:

Click **"Create bucket"**

**Step 1: Bucket settings**:
```
Bucket name: cis-filesearch-landing-dev-YOURNAME
             ↑ Replace YOURNAME with your name or random number
             ↑ Must be globally unique across ALL AWS accounts

AWS Region: ap-northeast-1 (Tokyo)
            ↑ Or your preferred region

Object Ownership: ACLs disabled (recommended)
```

**Step 2: Block Public Access**:
```
✓ Block all public access
  ↑ KEEP THIS CHECKED! Very important for security
```

**Step 3: Bucket Versioning**:
```
○ Disable
  ↑ For now, we'll enable later
```

**Step 4: Encryption**:
```
Encryption type: Server-side encryption with Amazon S3 managed keys (SSE-S3)
                 ↑ Free, automatic encryption
```

**Step 5: Review and create**:
- Click **"Create bucket"**

**✅ Success**: You should see your bucket in the list!

---

### Part 2: Upload Your First File (15 min)

**Via Console** (Easy way):

1. Click your bucket name
2. Click **"Upload"**
3. Click **"Add files"** → Select any file from your computer
4. Click **"Upload"**
5. Wait for "Upload succeeded" message

**Via CLI** (Professional way):

```bash
# Create a test file
echo "Hello from CIS File Search!" > test.txt

# Upload to S3
aws s3 cp test.txt s3://cis-filesearch-landing-dev-YOURNAME/

# Should show: upload: ./test.txt to s3://cis-filesearch-landing-dev-YOURNAME/test.txt

# List files in bucket
aws s3 ls s3://cis-filesearch-landing-dev-YOURNAME/

# Should show: 2025-01-18 10:30:00         28 test.txt

# Download file back
aws s3 cp s3://cis-filesearch-landing-dev-YOURNAME/test.txt downloaded-test.txt

# Verify content
cat downloaded-test.txt
# Should show: Hello from CIS File Search!
```

**✅ Success**: If upload and download work, S3 is configured correctly!

---

### Part 3: Understanding S3 Costs (15 min)

**Let's check what you just spent**:

```bash
# Check estimated costs (may take 24h to show)
aws ce get-cost-and-usage \
  --time-period Start=2025-01-01,End=2025-01-31 \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --group-by Type=DIMENSION,Key=SERVICE
```

**What that test cost**:
- Storage: 28 bytes ≈ $0.000000644 (basically free)
- Upload request: $0.000005
- Download request: $0.00000032

**Total**: Less than 0.001 cents 😊

**Realistic costs for 1TB**:
```
Storage (1TB):                  $23.00/month
PUT requests (1M files):          $5.00/month
GET requests (10M downloads):    $0.40/month

With Lifecycle (to Intelligent-Tiering after 7 days):
Storage (1TB):                  $15.00/month  ← 35% savings!
```

---

### Part 4: Clean Up Test Resources (10 min)

**Important**: Always clean up test resources to avoid charges!

```bash
# Delete test file
aws s3 rm s3://cis-filesearch-landing-dev-YOURNAME/test.txt

# Verify bucket is empty
aws s3 ls s3://cis-filesearch-landing-dev-YOURNAME/

# Should show nothing
```

**Keep the bucket**: We'll use it in next session!

---

### Part 5: Set Up Cost Tracking (15 min)

**Enable Cost Explorer**:

1. AWS Console → Search "Cost Explorer"
2. Click **"Cost Explorer"**
3. Click **"Enable Cost Explorer"** (if not already enabled)
4. Wait 24 hours for data to populate

**Create cost allocation tags**:

1. AWS Console → Search "Billing"
2. Left menu → **Cost Allocation Tags**
3. Click **"AWS-generated cost allocation tags"**
4. Activate tags:
   - `createdBy`
   - `aws:cloudformation:stack-name`
   - `Name`

**Tag your S3 bucket**:

```bash
aws s3api put-bucket-tagging \
  --bucket cis-filesearch-landing-dev-YOURNAME \
  --tagging 'TagSet=[
    {Key=Environment,Value=dev},
    {Key=Application,Value=CISFileSearch},
    {Key=ManagedBy,Value=YourName}
  ]'
```

**Check tags**:
```bash
aws s3api get-bucket-tagging --bucket cis-filesearch-landing-dev-YOURNAME
```

---

### Part 6: Navigation Practice (15 min)

Get comfortable with AWS Console:

**Exercise 1**: Find S3 metrics
1. S3 → Click your bucket
2. Tab: **Metrics**
3. Explore: Storage, Requests, Data transfer

**Exercise 2**: Find IAM dashboard
1. Top search → Type "IAM"
2. Explore: Users, Roles, Policies
3. Find your `cis-admin` user

**Exercise 3**: Find CloudWatch
1. Top search → Type "CloudWatch"
2. Left menu → **Dashboards** (probably empty for now)

**Exercise 4**: Find billing
1. Account name (top right) → **Billing Dashboard**
2. Explore: **Bills**, **Cost Explorer**

---

## 🎯 Session 1 Complete!

### What You Accomplished

✅ Created AWS account with MFA security
✅ Installed AWS CLI and configured credentials
✅ Created first S3 bucket
✅ Uploaded and downloaded files via CLI
✅ Set up cost tracking and billing alerts
✅ Navigated AWS Console like a pro

### Key Concepts Learned

1. **AWS Console**: Web interface for managing AWS
2. **AWS CLI**: Command-line tool for automation
3. **S3 Buckets**: Cloud storage for files
4. **IAM Users**: Secure credentials for access
5. **Cost Management**: Tracking and controlling expenses

---

## 📚 Next Steps

### Immediate Next Step (Next session)

**📘 Go to**: [Implementation Checklist](./02-IMPLEMENTATION-CHECKLIST.md)

This will guide you through:
- Session 2: IAM Roles & Security (2 hours)
- Session 3: SQS Queue Setup (1.5 hours)
- Session 4: OpenSearch & Processing (3 hours)

### Recommended Study (Optional)

**If you have extra time**, review these concepts:

1. **S3 Deep Dive** (30 min):
   - Read: [S3 Configuration Guide](./aws-s3-configuration-guide.md)
   - Learn about: Lifecycle policies, Versioning, Encryption

2. **IAM Basics** (30 min):
   - Read: [IAM Roles & Policies Guide](../security/iam-roles-policies-guide.md) - first 20 pages
   - Understand: Roles vs Users, Policies, Least Privilege

3. **AWS Cost Optimization** (20 min):
   - Watch: [AWS Cost Optimization Overview](https://youtube.com/watch?v=XHwFJDw0CIQ)
   - Learn: Free tier, Cost calculators, Budgets

---

## 🆘 Troubleshooting

### Common First-Timer Issues

**Issue**: "Access Denied" when using AWS CLI

**Diagnosis**:
```bash
aws sts get-caller-identity
# If this fails, credentials are wrong
```

**Fix**:
```bash
# Reconfigure credentials
aws configure

# Enter your access key and secret key again
```

---

**Issue**: Can't create S3 bucket - "BucketAlreadyExists"

**Cause**: Bucket names are globally unique

**Fix**: Add your name or random number to bucket name
```
cis-filesearch-landing-dev-john123
                           ↑ unique suffix
```

---

**Issue**: AWS CLI not found

**Fix macOS**:
```bash
# Install Homebrew first
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Then install AWS CLI
brew install awscli
```

**Fix Windows**:
- Download installer: https://awscli.amazonaws.com/AWSCLIV2.msi
- Run installer
- **Restart PowerShell** after installation

---

**Issue**: Forgot to save secret access key

**Fix**:
1. IAM → Users → Your user
2. Security credentials → Access keys
3. Make old key **Inactive** (don't delete yet)
4. Create new access key
5. Save it this time! Use password manager
6. Delete old key after confirming new one works

---

## 📖 Glossary of Terms

**AWS (Amazon Web Services)**: Amazon's cloud computing platform

**Region**: Physical location of AWS data centers (e.g., Tokyo, Virginia)

**IAM (Identity and Access Management)**: Service for managing access to AWS

**S3 (Simple Storage Service)**: Object storage service (like Dropbox)

**Bucket**: Container for files in S3 (like a folder)

**CLI (Command Line Interface)**: Text-based tool for controlling software

**MFA (Multi-Factor Authentication)**: Extra security step (password + code from phone)

**Access Key**: Like a username for programmatic access to AWS

**Secret Key**: Like a password for programmatic access to AWS

**ARN (Amazon Resource Name)**: Unique identifier for AWS resources

**Console**: AWS web interface (https://console.aws.amazon.com)

---

## 🎓 Learning Resources

### Free AWS Training
- [AWS Skill Builder](https://skillbuilder.aws/) - Free courses
- [AWS Getting Started](https://aws.amazon.com/getting-started/)

### YouTube Channels
- [AWS YouTube](https://youtube.com/user/AmazonWebServices)
- [freeCodeCamp AWS Tutorial](https://youtube.com/watch?v=3hLmDS179YE) (12 hours)

### Practice
- [AWS Free Tier](https://aws.amazon.com/free/) - Practice without spending
- [AWS Workshops](https://workshops.aws/) - Hands-on labs

---

## ✅ Pre-Flight Checklist for Session 2

Before your next session, verify:

- [ ] AWS account created and MFA enabled
- [ ] AWS CLI installed and configured
- [ ] IAM user created with access keys
- [ ] First S3 bucket created and tested
- [ ] Billing alerts configured
- [ ] Cost Explorer enabled
- [ ] Understanding of basic AWS concepts
- [ ] 2-3 hours available for next session

**All checked?** You're ready for [Session 2: IAM & Security](./02-IMPLEMENTATION-CHECKLIST.md#session-2-iam-roles--security)

---

**Document Version**: 1.0
**Last Updated**: 2025-01-18
**Next Review**: 2025-02-18

**Need help?** Check [Troubleshooting Guide](./troubleshooting-guide.md) or AWS Forums.

**Ready to continue?** → [Implementation Checklist](./02-IMPLEMENTATION-CHECKLIST.md)
