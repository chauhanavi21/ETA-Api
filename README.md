# ETApp Backend API

RESTful API server for ETApp expense tracker, built with Node.js, Express, and PostgreSQL.

## 🚀 Features

- **Personal Transactions**: CRUD operations for personal expenses
- **Group Management**: Create, join, and leave groups
- **Group Expenses**: Add, edit, delete, and split expenses
- **Balance Calculations**: Real-time debt tracking between users
- **Settlement**: Mark debts as paid
- **Push Notifications**: Real-time updates via Expo Push
- **User Profiles**: Update user information with auto-sync
- **Rate Limiting**: Upstash Redis-based rate limiting
- **Health Monitoring**: Cron job to keep server alive

## 🛠️ Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL (Neon serverless)
- **ORM**: @neondatabase/serverless
- **Rate Limiting**: Upstash Redis
- **Cron Jobs**: node-cron
- **Environment**: dotenv

## 📦 Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your credentials

# Start development server
npm run dev

# Start production server
npm start
```

## 🔐 Environment Variables

Create a `.env` file in the `backend/` directory:

```env
# Database
DATABASE_URL=postgresql://user:pass@host/database?sslmode=require

# Redis (Rate Limiting)
UPSTASH_REDIS_REST_URL=https://your-redis-url.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_redis_token

# Server Configuration
PORT=5001
NODE_ENV=development

# Cron Job (Production only)
API_URL=https://your-api-url.com/api/health
```

## 📁 Project Structure

```
backend/
├── src/
│   ├── config/
│   │   ├── db.js              # Database connection & schema
│   │   ├── upstash.js         # Redis client setup
│   │   └── cron.js            # Keep-alive cron job
│   │
│   ├── controllers/
│   │   ├── groupsController.js        # Group & expense logic
│   │   ├── transactionsController.js  # Personal transactions
│   │   ├── notificationsController.js # Push tokens
│   │   └── usersController.js         # User profile updates
│   │
│   ├── middleware/
│   │   └── rateLimiter.js     # Upstash rate limiting
│   │
│   ├── routes/
│   │   ├── groupsRoute.js
│   │   ├── transactionsRoute.js
│   │   ├── notificationsRoute.js
│   │   └── usersRoute.js
│   │
│   ├── utils/
│   │   └── pushNotifications.js  # Expo Push API
│   │
│   └── server.js              # Express app entry point
│
├── .env                       # Environment variables (gitignored)
├── .gitignore
├── package.json
└── README.md
```

## 🗄️ Database Schema

### Tables

#### `transactions`
Personal income/expense tracking
```sql
CREATE TABLE transactions (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  category VARCHAR(255) NOT NULL,
  created_at DATE NOT NULL DEFAULT CURRENT_DATE
);
```

#### `groups`
Group information and codes
```sql
CREATE TABLE groups (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(6) UNIQUE NOT NULL,
  created_by VARCHAR(255) NOT NULL,
  currency VARCHAR(10) DEFAULT 'USD',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### `group_members`
User memberships with names
```sql
CREATE TABLE group_members (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL,
  user_name VARCHAR(255) NOT NULL,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, user_id)
);
```

#### `group_expenses`
Group expense records
```sql
CREATE TABLE group_expenses (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  description VARCHAR(255) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  paid_by_user_id VARCHAR(255) NOT NULL,
  category VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### `expense_splits`
How expenses are divided
```sql
CREATE TABLE expense_splits (
  id SERIAL PRIMARY KEY,
  expense_id INTEGER NOT NULL REFERENCES group_expenses(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL,
  amount_owed DECIMAL(10,2) NOT NULL,
  is_settled BOOLEAN DEFAULT FALSE,
  settled_at TIMESTAMP,
  UNIQUE(expense_id, user_id)
);
```

#### `user_tokens`
Push notification tokens
```sql
CREATE TABLE user_tokens (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL UNIQUE,
  push_token VARCHAR(255) NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 📡 API Endpoints

### Health Check
```
GET /api/health
```
Returns server status

### Transactions (Personal)

#### Get User Transactions
```
GET /api/transactions/:userId
```

#### Get Summary
```
GET /api/transactions/summary/:userId
```
Returns balance, income, expenses

#### Create Transaction
```
POST /api/transactions
Body: { user_id, title, amount, category }
```

#### Delete Transaction
```
DELETE /api/transactions/:id
```

#### Delete All User Transactions
```
DELETE /api/transactions/user/:userId
```

### Groups

#### Create Group
```
POST /api/groups
Body: { name, userId, userName, currency }
```
Returns group with unique 6-character code

#### Join Group
```
POST /api/groups/join
Body: { code, userId, userName }
```

#### Leave Group
```
POST /api/groups/leave
Body: { groupId, userId }
```
Validates no unsettled debts

#### Get User's Groups
```
GET /api/groups/user/:userId
```

#### Get Group Details
```
GET /api/groups/:groupId
```

#### Get Group Members
```
GET /api/groups/:groupId/members
```

### Expenses

#### Add Expense
```
POST /api/groups/:groupId/expenses
Body: {
  groupId,
  description,
  amount,
  paidBy,      # Can be any member (not just current user)
  category,
  splits: [{ userId, amount }]
}
```

#### Update Expense
```
PUT /api/groups/expenses/:expenseId
Body: { description, amount, category, splits }
```

#### Delete Expense
```
DELETE /api/groups/expenses/:expenseId
Body: { userId }  # Authorization check
```

#### Get Group Expenses
```
GET /api/groups/:groupId/expenses
```

#### Get Expense Splits
```
GET /api/groups/expenses/:expenseId/splits
```

### Balance & Settlement

#### Get User Balance in Group
```
GET /api/groups/:groupId/balance/:userId
```
Returns:
- Total paid by user
- Total owed by user
- Net balance
- Detailed breakdown (who owes whom)

#### Settle Up
```
POST /api/groups/settle
Body: { groupId, fromUserId, toUserId }
```
Marks all debts between two users as settled

### Notifications

#### Register Push Token
```
POST /api/notifications/register
Body: { userId, pushToken }
```

#### Unregister Push Token
```
POST /api/notifications/unregister
Body: { userId }
```

### User Profile

#### Update User Name
```
PUT /api/users/profile
Body: { userId, userName }
```
Updates name across all groups and expenses

#### Get User Profile
```
GET /api/users/profile/:userId
```

## 🔔 Push Notifications

The API sends push notifications for:

- **New Member Joined**: When someone joins a group
- **Expense Added**: When a new expense is added
- **Expense Updated**: When an expense is edited
- **Expense Deleted**: When an expense is removed
- **Member Left**: When someone leaves a group
- **Settlement**: When debts are settled

### Notification Function
```javascript
import { notifyGroupMembers, notifyUser } from "./utils/pushNotifications.js";

// Notify all group members except excludeUserId
await notifyGroupMembers(
  sql,
  groupId,
  excludeUserId,
  "Title",
  "Message body",
  { type: 'event_type', data: {...} }
);

// Notify specific user
await notifyUser(
  sql,
  userId,
  "Title",
  "Message body",
  { type: 'event_type', data: {...} }
);
```

## 🛡️ Security Features

### Rate Limiting
- **Upstash Redis**: Distributed rate limiting
- **Middleware**: `backend/src/middleware/rateLimiter.js`
- **Configuration**: Adjustable limits per endpoint

### SQL Injection Prevention
- **Parameterized Queries**: All queries use bound parameters
- **Neon Postgres**: Automatic sanitization

### Authorization
- User can only modify their own data
- Expense deletion restricted to payer
- Group operations validated against membership

### Environment Protection
- Sensitive data in `.env` (gitignored)
- No hardcoded credentials
- Production-ready configuration

## 🔄 Cron Jobs

### Keep-Alive Ping (Production Only)
```javascript
// Runs every 14 minutes to prevent cold starts
cron.schedule("*/14 * * * *", async () => {
  await fetch(process.env.API_URL);
});
```

Activated when `NODE_ENV=production`

## 🧪 Testing

### Manual Testing with cURL

#### Create Group
```bash
curl -X POST http://localhost:5001/api/groups \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Weekend Trip",
    "userId": "user_123",
    "userName": "John Doe"
  }'
```

#### Add Expense
```bash
curl -X POST http://localhost:5001/api/groups/1/expenses \
  -H "Content-Type: application/json" \
  -d '{
    "groupId": 1,
    "description": "Dinner",
    "amount": 150.00,
    "paidBy": "user_123",
    "category": "food",
    "splits": [
      { "userId": "user_123", "amount": 50 },
      { "userId": "user_456", "amount": 50 },
      { "userId": "user_789", "amount": 50 }
    ]
  }'
```

#### Get Balance
```bash
curl http://localhost:5001/api/groups/1/balance/user_123
```

## 🚀 Deployment

### Recommended Platforms
- **Render**: Easy setup, free tier available
- **Railway**: Simple deployment, PostgreSQL included
- **Heroku**: Classic PaaS option
- **Vercel/Netlify**: Serverless functions

### Deployment Steps (Render)

1. **Create Web Service**
   - Connect GitHub repository
   - Root directory: `backend`
   - Build command: `npm install`
   - Start command: `npm start`

2. **Environment Variables**
   - Add all variables from `.env`
   - Set `NODE_ENV=production`

3. **Database**
   - Use Neon (serverless PostgreSQL)
   - Copy connection string to `DATABASE_URL`

4. **Redis**
   - Create Upstash Redis database
   - Add REST URL and token

5. **Deploy**
   - Trigger deployment
   - Check logs for any issues

### Post-Deployment

1. Test health endpoint: `https://your-api.com/api/health`
2. Update mobile app API URL
3. Test all endpoints
4. Monitor logs for errors

## 📊 Monitoring

### Health Check
```bash
curl https://your-api.com/api/health
```

### Logs
```bash
# View logs on Render
render logs

# View logs on Railway  
railway logs
```

### Database Monitoring
- Neon dashboard for query performance
- Connection pooling stats
- Database size and usage

## 🐛 Troubleshooting

### Database Connection Issues
```bash
# Test connection
node -e "const {sql} = require('./src/config/db'); sql\`SELECT 1\`.then(console.log)"
```

### Rate Limiting Not Working
- Verify Upstash credentials
- Check Redis dashboard
- Test with multiple requests

### Cron Job Not Running
- Ensure `NODE_ENV=production`
- Check `API_URL` is set correctly
- View logs for cron execution

### Push Notifications Failing
- Verify Expo Push tokens are valid
- Check Expo Push API status
- Validate notification payload

## 🔧 Development Tips

### Hot Reload
```bash
npm run dev  # Uses nodemon for auto-restart
```

### Database Migrations
```javascript
// Add to src/config/db.js initDB()
await sql`ALTER TABLE table_name ADD COLUMN new_col TYPE`;
```

### Debug Mode
```javascript
// Add console logs
console.log("Debug:", variable);

// Or use debug package
const debug = require('debug')('api:controller');
debug('Processing request');
```

## 📈 Performance Optimization

- **Connection Pooling**: Neon handles automatically
- **Rate Limiting**: Prevents abuse
- **Indexed Queries**: Add indexes to frequently queried columns
- **Caching**: Consider Redis caching for hot data

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes
4. Test thoroughly
5. Submit pull request

## 📄 License

MIT License - see LICENSE file for details

---

Built with ❤️ using Node.js and Express
