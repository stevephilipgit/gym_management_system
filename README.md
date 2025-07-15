
# Gym Management System

A comprehensive, full-stack gym management platform built with modern web technologies. This system manages members, attendance, billing, analytics, and administrative operations for fitness facilities.

## 🎯 Features

### Core Features
- **Member Management**: Complete member lifecycle (registration, profile updates, status tracking)
- **Attendance Tracking**: Real-time punch-in/punch-out system with daily/monthly analytics
- **Billing & Invoicing**: Package management, automated invoicing, and payment tracking
- **Admin Dashboard**: Comprehensive analytics and reporting with real-time insights
- **Authentication**: Secure JWT-based auth with role-based access control (RBAC)
- **Search & Validation**: Advanced member search with comprehensive input validation

### Advanced Features
- **Real-time Analytics**: Dashboard with charts, graphs, and KPI tracking
- **AI-Powered Reminders**: Automated membership renewal and payment reminders via Gemini AI
- **PDF Reports & Export**: Generate and download attendance/billing reports
- **Responsive UI**: Mobile-friendly design with Tailwind CSS
- **Performance Optimized**: Database indexing, query optimization, and caching strategies

## 📊 Tech Stack

### Backend
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT (JSON Web Tokens)
- **Caching**: Redis (optional, for performance)
- **AI Integration**: Google Gemini API
- **File Upload**: Multer
- **Job Scheduler**: Node-cron for automated tasks
- **Validation**: Joi/custom validators
- **Security**: CORS, CSRF protection, Rate limiting, Input sanitization

### Frontend
- **Framework**: React.js
- **Build Tool**: Vite
- **Styling**: Tailwind CSS + PostCSS
- **Charts**: Chart.js / React Chart Library
- **State Management**: React Hooks / Context API
- **HTTP Client**: Axios
- **PDF Generation**: JSPDF / similar libraries

### DevOps & Tools
- **Version Control**: Git
- **Package Management**: npm
- **Code Quality**: ESLint, Prettier
- **Testing**: Jest, Mocha (setup ready)

## 🚀 Getting Started

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn
- MongoDB instance (local or Atlas)
- Google Gemini API key (optional, for AI features)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/stevephilipgit/gym_management_system.git
   cd gym_management_system
   ```

2. **Setup Backend**
   ```bash
   cd backend
   npm install
   ```

3. **Configure Environment**
   ```bash
   # Copy and edit the environment template
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Setup Database**
   ```bash
   # Create admin user
   npm run create-admin
   
   # Seed sample data (optional)
   npm run seed
   
   # Create database indexes
   npm run create-indexes
   ```

5. **Start Backend Server**
   ```bash
   npm start
   ```

6. **Setup Frontend** (in new terminal)
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

7. **Access Application**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:5000/api

## 📁 Project Structure

```
gym_management_system/
│
├── backend/
│   ├── .env
│   ├── package.json
│   ├── server.js
│   ├── seed.js
│   ├── checkOptimization.js
│   ├── createAdmin.js
│   ├── createIndexes.js
│   ├── src/
│   │   ├── app.js
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── jobs/
│   │   ├── middleware/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── uploads/
│   │   ├── utils/
│   ├── logs/
│   └── scripts/
│
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.cjs
│   ├── postcss.config.cjs
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   ├── index.css
│   │   ├── package_manage.css
│   │   ├── theme.js
│   │   ├── admin/
│   │   ├── assets/
│   │   ├── components/
│   │   ├── pages/
│   │   └── utils/
│   └── public/
│
├── uploads/
├── .env.example
├── .gitignore
├── LICENSE (MIT)
└── README.md
```

## 🔑 Key Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login

### Members
- `GET /api/members` - List all members
- `POST /api/members` - Create new member
- `GET /api/members/:id` - Get member details

### Attendance
- `POST /api/attendance/punch-in` - Record punch-in
- `POST /api/attendance/punch-out` - Record punch-out

### Billing
- `GET /api/packages` - List membership packages
- `POST /api/invoices` - Create invoice

### Analytics
- `GET /api/analytics/dashboard` - Dashboard metrics

## 🔐 Security

- JWT token-based authentication
- Role-based access control (RBAC)
- Input validation and sanitization
- CORS and CSRF protection
- Rate limiting
- Password hashing with bcrypt
- Environment variables for sensitive data

## 📚 Documentation

Complete documentation and implementation guides are included in the project root:
- `QUICK_START_GUIDE.txt` - Quick start instructions
- `DEPLOYMENT_GUIDE.md` - Production deployment
- `GYM_DATABASE_SCHEMA.txt` - Database structure
- `PERFORMANCE_OPTIMIZATION_GUIDE.txt` - Performance tuning
- `ANALYTICS_START_HERE.md` - Analytics features

## 🎯 Current Status

✅ Core features complete
✅ Authentication and RBAC implemented
✅ Attendance tracking operational
✅ Analytics and reporting functional
✅ Production optimizations applied

## 👤 Author

**Steve Philip** - Full-stack development

## 📄 License

This project is licensed under the MIT License - see [LICENSE](LICENSE) file for details.

---

**Last Updated**: April 2026
**Status**: Production Ready ✨
