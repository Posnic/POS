# 🚀 Posnic v2 - Express.js API Backend

✅ **Authentication** - JWT + Session Perfect  
✅ **Authorization** - ACL  

---

## 🏗️ Project Structure
 
```
Api_v2_express/
├── app.js                 # Express app configuration
├── server.js              # Server entry point
├── package.json           # Dependencies
├── .env                   # Environment variables
│
├── src/                   # 💻 Source Code
│   ├── config/            # Configuration (7 files)
│   ├── controllers/       # Controllers (24 files)
│   ├── middleware/        # Middleware (14 files)
│   ├── models/            # Mongoose models (28 files)
│   ├── routes/            # API routes (23 files)
│   ├── services/          # Business logic (2 files)
│   ├── utils/             # Utilities (11 files)
│   ├── validators/        # Validation schemas (1 file)
│   └── constants/         # Constants (1 file)
│
├── scripts/               # Utility scripts (9 files)
├── public/                # Static files
├── uploads/               # File uploads
└── json/                  # JSON data files
```

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create `.env` file:

```env
# Server
PORT=5000
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/posnicpro

# JWT
JWT_SECRET=your-super-secret-key-min-32-characters
JWT_EXPIRES_IN=7d
JWT_COOKIE_EXPIRES_IN=7

# Session
SESSION_SECRET=your-session-secret-key

# CORS
CORS_ORIGIN=http://localhost:3000
```

### 3. Start Server

```bash
# Development
npm run dev

# Production
npm start
```

### 4. Access API

```
API Base URL: http://localhost:5000/api
```

---

## 🔐 Authentication

### Login

```bash
POST /api/users/verify
Content-Type: application/json

{
  "username": "your-username",
  "password": "your-password"
}

# Returns JWT token
```

### Using Token

```bash
# Option 1: Header
GET /api/items
Authorization: Bearer YOUR_JWT_TOKEN

# Option 2: Cookie (automatic after login)
GET /api/items
Cookie: jwt=YOUR_JWT_TOKEN
```

---

## 📝 API Response Format

All responses follow PHP-compatible format:

### Success Response

```json
{
  "type": "success",
  "message": "Items retrieved successfully",
  "data": {
    "list": [...],
    "total": 100,
    "page": 1,
    "limit": 10
  }
}
```

### Error Response

```json
{
  "type": "error",
  "message": "Unauthorized",
  "data": null
}
```

---

## 🔑 Authorization (ACL)

### Permission Structure

```javascript
{
  "item": { "read": true, "write": true, "delete": false },
  "user": { "read": true, "write": false, "delete": false },
  "sales": { "read": true, "write": true, "delete": false },
  "report": { "read": true, "write": false, "delete": false }
  // ... etc
}
```

### High Privilege Roles

- `super_admin` - Full access to everything
- `admin` - Full access to everything
- `manager` - Full access to everything
- `api` - Full access to everything

### Permission Check

Controllers automatically check permissions using:

```javascript
if (!this.checkPermission('item', 'read', req.user)) {
  return this.error(res, 'Unauthorized', 403);
}
```

---

## 🛠️ Development

### Project Scripts

```json
{
  "start": "node server.js",
  "dev": "nodemon server.js",
  "test": "jest",
  "lint": "eslint .",
  "format": "prettier --write ."
}
```

### Code Standards

- ✅ ES6+ JavaScript
- ✅ Async/await for async operations
- ✅ Error handling with try-catch
- ✅ Consistent response format
- ✅ JWT authentication
- ✅ MongoDB/Mongoose ORM
- ✅ Express.js best practices

---

## 🔧 Configuration

### Config Files Location

All configuration in `src/config/`:

- `config.js` - Main configuration
- `database.js` - MongoDB connection
- `auth.js` - Authentication config
- `environment.js` - Environment settings
- `tokens.js` - Token types
- `roles.js` - User roles

---

## 📦 Dependencies

### Main Dependencies

- **express** - Web framework
- **mongoose** - MongoDB ODM
- **jsonwebtoken** - JWT authentication
- **bcryptjs** - Password hashing
- **helmet** - Security headers
- **cors** - CORS middleware
- **express-validator** - Input validation
- **pdfkit** - PDF generation
- **exceljs** - Excel generation
- **node-cron** - Scheduled tasks

---

## 🚀 Deployment

### Environment Setup

1. Set `NODE_ENV=production`
2. Configure production MongoDB URI
3. Set strong JWT_SECRET (32+ chars)
4. Enable HTTPS
5. Configure CORS for production domain

### Production Checklist

- [ ] Environment variables configured
- [ ] MongoDB connection tested
- [ ] SSL/TLS enabled
- [ ] JWT secret is strong
- [ ] CORS configured for production
- [ ] Error logging enabled
- [ ] Rate limiting configured
- [ ] File upload limits set
- [ ] Backup strategy in place

---

## 📊 Performance

### Optimizations

✅ Connection pooling (MongoDB)  
✅ Response compression  
✅ Rate limiting  
✅ Input sanitization  
✅ XSS protection  
✅ NoSQL injection prevention  
✅ Efficient queries with indexes  
✅ Stateless JWT authentication  

---

## 🔒 Security

### Implemented Security

- ✅ Helmet security headers
- ✅ CORS protection
- ✅ Rate limiting
- ✅ XSS protection
- ✅ NoSQL injection prevention
- ✅ JWT authentication
- ✅ Password hashing (bcrypt)
- ✅ Input validation & sanitization
- ✅ HTTP-only cookies
- ✅ Secure cookies in production

---

## 🐛 Troubleshooting

### Common Issues

**MongoDB Connection Failed**
```bash
# Check MongoDB is running
mongosh

# Verify connection string in .env
MONGODB_URI=mongodb://localhost:27017/posnicpro
```

**JWT Token Invalid**
```bash
# Check JWT_SECRET is set
# Check token expiration
# Re-login to get new token
```

**CORS Errors**
```bash
# Configure CORS_ORIGIN in .env
CORS_ORIGIN=http://localhost:3000
```
