const express = require('express')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken');
require('dotenv').config();
const cors = require('cors')
const client = require('./database');
const app = express()

app.use(express.json());
app.use(cors());

app.get('/', (req, res) => {
    res.send('Welcome to Application Tracker!');
})

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: "Access Token Required" });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: "Invalid Token" });
        }
        req.user = user;
        next();
    });
}

// signup
app.post('/signup', async (req, res) => {
    try {
        console.log("Signup request received:", req.body);

        const { email, password, username, goal } = req.body;

        if (!email || !password || !username || !goal) {
            return res.status(400).json({ message: "All fields are required" });
        }

        const existingUserQuery = 'SELECT * FROM users WHERE email = $1';
        const existingUserResult = await client.query(existingUserQuery, [email]);
        if (existingUserResult.rows.length > 0) {
            console.log("User already exists:", email);
            return res.status(400).json({ message: "User already exists" });
        }

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        const insertQuery = `
            INSERT INTO users (email, password, username, goal) 
            VALUES ($1, $2, $3, $4) RETURNING *;
        `;
        const values = [email, hashedPassword, username, goal];
        const newUserResult = await client.query(insertQuery, values);
        const newUser = newUserResult.rows[0];

        console.log("User created:", newUser);

        const token = jwt.sign({ email: newUser.email, id: newUser.user_id }, process.env.JWT_SECRET, { expiresIn: '24h' });

        console.log("Signup successful, token generated:", token);
        res.status(201).json({ 
            message: "Signup Successful", 
            token, 
            user: {
                id: newUser.user_id,
                email: newUser.email,
                username: newUser.username,
                goal: newUser.goal
            }
        });
    } catch (error) {
        console.error("Signup error:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// login
app.post('/login', async (req, res) => {
    try {
        console.log("Login request received:", req.body);

        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: "Email and password are required" });
        }

        const userQuery = 'SELECT * FROM users WHERE email = $1';
        const userResult = await client.query(userQuery, [email]);

        if (userResult.rows.length === 0) {
            console.log("User not found:", email);
            return res.status(404).json({ message: "Invalid email or password" });
        }

        const user = userResult.rows[0];

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            console.log("Invalid password for user:", email);
            return res.status(401).json({ message: "Invalid email or password" });
        }

        const token = jwt.sign({ id: user.user_id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '24h' });

        console.log("Login successful, token generated:", token);
        res.status(200).json({
            message: "Login successful",
            token,
            user: {
                id: user.user_id,
                email: user.email,
                username: user.username,
                goal: user.goal
            }
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// add a new application
app.post('/applications', authenticateToken, async (req, res) => {
    try {
        console.log("Add application request received:", req.body);

        const { submission_date, location, position, company_name, status, notes } = req.body;
        const user_id = req.user.id;

        if (!submission_date || !location || !position || !company_name || !status) {
            return res.status(400).json({ message: "Missing required fields" });
        }

        const validStatuses = ["Applied", "Interview Scheduled", "Interview Completed", "Offer Received", "Rejected"];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }

        const insertQuery = `
            INSERT INTO applications (user_id, submission_date, location, position, company_name, status, notes) 
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
        `;
        const values = [user_id, submission_date, location, position, company_name, status, notes || null];
        const result = await client.query(insertQuery, values);

        console.log("Application added:", result.rows[0]);

        res.status(201).json({
            message: "Application added successfully",
            application: result.rows[0]
        });
    } catch (error) {
        console.error("Error adding application:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// get applications for user
app.get('/applications', authenticateToken, async (req, res) => {
    try {
        const user_id = req.user.id;

        const query = `
            SELECT * FROM applications WHERE user_id = $1 ORDER BY submission_date DESC;
        `;
        const result = await client.query(query, [user_id]);

        // if (result.rows.length === 0) {
        //     return res.status(404).json({ message: "No applications found for this user" });
        // }

        res.status(200).json({
            message: "Applications fetched successfully",
            applications: result.rows
        });
    } catch (error) {
        console.error("Error fetching applications:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// get progress analytics
app.get('/progress-analytics', authenticateToken, async (req, res) => {
    try {
        const user_id = req.user.id;

        const totalSubmissionsQuery = `
            SELECT COUNT(*) AS total_submissions 
            FROM applications 
            WHERE user_id = $1;
        `;
        const totalSubmissionsResult = await client.query(totalSubmissionsQuery, [user_id]);
        const totalSubmissions = parseInt(totalSubmissionsResult.rows[0].total_submissions, 10);

        const interviewsQuery = `
            SELECT COUNT(*) AS interviews_received 
            FROM applications 
            WHERE user_id = $1 
            AND (status = 'Interview Scheduled' OR status = 'Interview Completed' OR status = 'Offer Received');
        `;
        const interviewsResult = await client.query(interviewsQuery, [user_id]);
        const interviewsReceived = parseInt(interviewsResult.rows[0].interviews_received, 10);

        const successQuery = `
            SELECT COUNT(*) AS successful_applications 
            FROM applications 
            WHERE user_id = $1 
            AND (status = 'Interview Scheduled' OR status = 'Interview Completed' OR status = 'Offer Received');
        `;
        const successResult = await client.query(successQuery, [user_id]);
        const successfulApplications = parseInt(successResult.rows[0].successful_applications, 10);

        const successRate = totalSubmissions > 0 ? (successfulApplications / totalSubmissions) * 100 : 0;

        res.status(200).json({
            message: "Progress analytics fetched successfully",
            analytics: {
                total_submissions: totalSubmissions,
                interviews_received: interviewsReceived,
                success_rate: successRate.toFixed(2)
            }
        });
    } catch (error) {
        console.error("Error fetching progress analytics:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// update application status
app.patch('/applications/:id/status', authenticateToken, async (req, res) => {
    try {
        const user_id = req.user.id;
        const application_id = parseInt(req.params.id, 10);
        const { status } = req.body;

        const validStatuses = ["Applied", "Interview Scheduled", "Interview Completed", "Offer Received", "Rejected"];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
            });
        }

        const applicationQuery = `
            SELECT * FROM applications WHERE application_id = $1 AND user_id = $2;
        `;
        const applicationResult = await client.query(applicationQuery, [application_id, user_id]);

        if (applicationResult.rows.length === 0) {
            return res.status(404).json({ message: "Application not found or you do not have permission to edit this application" });
        }

        const updateQuery = `
            UPDATE applications SET status = $1 WHERE application_id = $2 AND user_id = $3 RETURNING *;
        `;
        const updateResult = await client.query(updateQuery, [status, application_id, user_id]);

        res.status(200).json({
            message: "Application status updated successfully",
            application: updateResult.rows[0]
        });
    } catch (error) {
        console.error("Error updating application status:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// delete an application
app.delete('/applications/:id', authenticateToken, async (req, res) => {
    try {
        const user_id = req.user.id;
        const application_id = parseInt(req.params.id, 10);

        const applicationQuery = `
            SELECT * FROM applications WHERE application_id = $1 AND user_id = $2;
        `;
        const applicationResult = await client.query(applicationQuery, [application_id, user_id]);

        if (applicationResult.rows.length === 0) {
            return res.status(404).json({ message: "Application not found or you do not have permission to delete this application" });
        }

        const deleteQuery = `
            DELETE FROM applications WHERE application_id = $1 AND user_id = $2;
        `;
        await client.query(deleteQuery, [application_id, user_id]);

        res.status(200).json({
            message: "Application deleted successfully"
        });
    } catch (error) {
        console.error("Error deleting application:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});


const port = 3000;
app.listen(port, () => {
   console.log(`Server is running on Port: ${port}`);
});