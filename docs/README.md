# API Documentation

This directory contains the API documentation for the AI Audiobook Backend.

## 📚 Documentation Files

- **`openapi.yml`**: OpenAPI 3.0 specification for all API endpoints
- **`index.html`**: Interactive Swagger UI for testing and exploring the API

## 🚀 Quick Start

### Viewing the Documentation

#### Option 1: Open Locally

Simply open `index.html` in your web browser to view the interactive API
documentation.

#### Option 2: Local Server

For better CORS support, serve the documentation with a local server:

```bash
# Using Python 3
cd docs
python3 -m http.server 8000

# Using Node.js (npx)
npx http-server docs -p 8000

# Using VS Code Live Server extension
# Right-click on index.html and select "Open with Live Server"
```

Then navigate to: `http://localhost:8000`

## 🔐 Authentication

The API supports two authentication methods:

### 1. SupabaseAuth (API Key)

- **Type**: API Key
- **Header**: `apikey`
- **Value**: Your Supabase anonymous key
- **Use Case**: Public endpoints like signup, login, password reset

### 2. BearerAuth (JWT)

- **Type**: HTTP Bearer
- **Header**: `Authorization`
- **Format**: `Bearer <your-jwt-token>`
- **Use Case**: Protected endpoints requiring user authentication

### How to Authenticate in Swagger UI

1. Click the **"Authorize"** button at the top of the Swagger UI
2. Enter your credentials:
   - **SupabaseAuth**: Enter your Supabase anon key
   - **BearerAuth**: Enter the JWT token you received from `/login`
3. Click **"Authorize"** and then **"Close"**

## 📋 Available Endpoints

### Authentication Endpoints

| Endpoint          | Method | Description                      | Auth Required |
| ----------------- | ------ | -------------------------------- | ------------- |
| `/signUp`         | POST   | Register a new user              | No            |
| `/login`          | POST   | Authenticate user                | No            |
| `/logout`         | POST   | Logout user (invalidate session) | No            |
| `/refreshToken`   | POST   | Refresh access token             | No            |
| `/forgotPassword` | POST   | Request password reset email     | No            |
| `/resetPassword`  | POST   | Reset user password              | No            |

### Settings Management Endpoints

| Endpoint             | Method | Description                      | Auth Required |
| -------------------- | ------ | -------------------------------- | ------------- |
| `/getAllIndustries`  | GET    | Get list of all industries       | No            |
| `/getUserProfile`    | GET    | Get authenticated user's profile | Yes (JWT)     |
| `/updateUserProfile` | PUT    | Update user profile & upload pic | Yes (JWT)     |
| `/changePassword`    | POST   | Change user password             | Yes (JWT)     |
| `/createUser`        | POST   | Create user in organization      | Yes (JWT)     |
| `/deleteUser`        | DELETE | Delete user from organization    | Yes (JWT)     |

## 🌐 Environment URLs

### QA Environment

```
Base URL: https://hskaqvjruqzmgrwxmxxd.supabase.co/functions/v1
```

## 💡 Testing in Swagger UI

1. **Sign Up a New User**
   - Expand the `/signUp` endpoint
   - Click "Try it out"
   - Fill in the request body with email, password, and fullName
   - Click "Execute"
   - Copy the returned user details

2. **Login**
   - Expand the `/login` endpoint
   - Click "Try it out"
   - Enter the email and password you used for signup
   - Click "Execute"
   - Copy the `token` from the response

3. **Authorize Future Requests**
   - Click the "Authorize" button at the top
   - Paste the token in the **BearerAuth** field
   - Click "Authorize"

4. **Test Other Endpoints**
   - All subsequent requests will now include your authentication token

## 🔒 Password Requirements

All passwords must meet these requirements:

- Minimum 8 characters
- At least one uppercase letter (A-Z)
- At least one lowercase letter (a-z)
- At least one number (0-9)
- At least one special character (!@#$%^&*)

## 📝 User Types

New users are assigned the following default values:

- **`userType`**: `ADMIN` (access level: ADMIN, MEMBER, or OWNER)
- **`role`**: `null` (job title, can be updated later)

## 📞 Support

For API support or questions, please contact the development team.

## 🔄 Updating Documentation

When adding new endpoints:

1. Update `openapi.yml` with the new endpoint specification
2. Follow the existing pattern for consistency
3. Include examples for all request/response scenarios
4. Document all required and optional parameters
5. Test the documentation in Swagger UI before committing

## 📖 OpenAPI Resources

- [OpenAPI Specification](https://swagger.io/specification/)
- [Swagger Editor](https://editor.swagger.io/) - Validate your OpenAPI spec
- [Swagger UI Documentation](https://swagger.io/tools/swagger-ui/)
