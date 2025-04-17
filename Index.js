const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const jwt = require("jsonwebtoken");
const { mongoConnect, getDb } = require("./Database");
const { MongoClient, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = 8000;

app.use(cors());
app.use(bodyParser.json({ limit: "100mb" }));
app.use(bodyParser.urlencoded({ limit: "100mb", extended: true }));

// Secret key for JWT
const secretKey = "admin_vishu";

// Function to generate JWT token
const generateToken = (user) => {
  return jwt.sign({ userId: user._id, email: user.email }, secretKey, {
    expiresIn: "1h",
  });
};

// Function to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.header("Authorization");
  if (!token)
    return res
      .status(401)
      .send({ status: "fail", message: "Access denied. No token provided." });

  try {
    const decoded = jwt.verify(token.replace("Bearer ", ""), secretKey);
    req.user = decoded;
    next();
  } catch (ex) {
    return res.status(400).send({ status: "fail", message: "Invalid token." });
  }
};

// -----------------------------------
// Employee Registration & Login APIs
// -----------------------------------

app.post("/register", async (req, res) => {
  try {
    const db = getDb();
    const { Fullname, Email, Contact, Address, Password, Confirmpassword } =
      req.body;
    const existingUser = await db
      .collection("employee register")
      .findOne({ $or: [{ email: Email }, { contact: Contact }] });
    if (existingUser) {
      return res
        .status(400)
        .send({
          status: "fail",
          message: "Email or Contact already registered",
        });
    }
    const user = {
      fullname: Fullname,
      email: Email,
      contact: Contact,
      address: Address,
      password: Password,
      Confirmpassword,
      createdAt: new Date(),
      lastLogin: null,
      walletBalance: 0,  // Initialize wallet balance
    };
    await db.collection("employee register").insertOne(user);
    res.send({ status: "success", message: "Data inserted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).send({ status: "fail", message: "Error registering user" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const db = getDb();
    const { Email, Password } = req.body;
    
    // Find user by email or contact
    const user = await db
      .collection("employee register")
      .findOne({ 
        $or: [{ email: Email }, { contact: Email }]
      });
    
    if (!user) {
      return res
        .status(401)
        .send({ status: "fail", message: "Invalid email/contact or password" });
    }
    
    // Verify password
    if (user.password !== Password) {
      return res
        .status(401)
        .send({ status: "fail", message: "Invalid email/contact or password" });
    }
    
    // Update last login time
    user.lastLogin = new Date();
    await db
      .collection("employee register")
      .updateOne({ _id: user._id }, { $set: { lastLogin: user.lastLogin } });
    
    const token = generateToken(user);
    
    // Ensure walletBalance is included in response
    const walletBalance = user.walletBalance ? Number(user.walletBalance) : 0;
    
    res.send({
      status: "success",
      message: "Logged in successfully",
      token: token,
      data: {
        _id: user._id,
        fullname: user.fullname,
        email: user.email,
        contact: user.contact,
        address: user.address,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        walletBalance: walletBalance
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).send({ status: "fail", message: "Error logging in" });
  }
});

// GET endpoint to fetch wallet balance
app.get("/get-wallet-balance/:userId", async (req, res) => {
  try {
    const db = getDb();
    const userId = req.params.userId;
    
    // Validate userId
    if (!userId) {
      return res.status(400).json({ 
        status: "error", 
        message: "Invalid user ID" 
      });
    }
    
    const objectId = new ObjectId(userId);
    const user = await db.collection("employee register").findOne({ _id: objectId });
    
    if (!user) {
      return res.status(404).json({ 
        status: "error", 
        message: "User not found" 
      });
    }
    
    const walletBalance = user.walletBalance ? Number(user.walletBalance) : 0;
    
    return res.json({ 
      status: "success", 
      walletBalance: walletBalance 
    });
  } catch (err) {
    console.error("Error fetching wallet balance:", err);
    return res.status(500).json({ 
      status: "error", 
      message: "An error occurred while processing your request" 
    });
  }
});

// Endpoint to add funds to wallet
app.post("/add-wallet-funds", async (req, res) => {
  try {
    const db = getDb();
    const { userId, amount } = req.body;

    // Validate inputs
    if (!userId || !amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        status: "error",
        message: "Invalid user ID or amount"
      });
    }

    // Convert userId to ObjectId and amount to number
    const objectId = new ObjectId(userId);
    const numericAmount = Number(amount);

    // Find the user
    const user = await db.collection("employee register").findOne({ _id: objectId });
    
    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found"
      });
    }

    // Calculate new balance (if wallet balance doesn't exist yet, start from 0)
    const currentBalance = user.walletBalance ? Number(user.walletBalance) : 0;
    const newBalance = currentBalance + numericAmount;

    // Update the user's wallet balance
    const result = await db.collection("employee register").updateOne(
      { _id: objectId },
      { 
        $set: { 
          walletBalance: newBalance,
          lastWalletUpdate: new Date()
        } 
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(500).json({
        status: "error",
        message: "Failed to update wallet balance"
      });
    }

    // Create a wallet transaction record (optional but recommended for tracking)
    await db.collection("wallet_transactions").insertOne({
      userId: objectId,
      amount: numericAmount,
      type: "credit",
      previousBalance: currentBalance,
      newBalance: newBalance,
      timestamp: new Date(),
      description: "Admin added funds"
    });

    return res.json({
      status: "success",
      message: `Successfully added ${numericAmount} to user's wallet`,
      currentBalance: newBalance
    });
  } catch (err) {
    console.error("Error adding funds to wallet:", err);
    return res.status(500).json({
      status: "error",
      message: "An error occurred while processing your request"
    });
  }
});

// Protected route
app.get("/protected", verifyToken, async (req, res) => {
  try {
    const db = getDb();
    const user = await db
      .collection("employee register")
      .findOne({ _id: req.user.userId });
    if (!user) {
      return res
        .status(404)
        .send({ status: "fail", message: "User not found" });
    }
    
    // Include wallet balance in response
    const walletBalance = user.walletBalance ? Number(user.walletBalance) : 0;
    
    res.send({
      status: "success",
      message: "Hello, " + user.fullname,
      data: {
        fullname: user.fullname,
        email: user.email,
        contact: user.contact,
        address: user.address,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        walletBalance: walletBalance
      },
    });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .send({ status: "fail", message: "Error fetching user data" });
  }
});

// -----------------------------------
// Admin Registration & Login APIs
// -----------------------------------

app.post("/register-admin", async (req, res) => {
  try {
    const db = getDb();
    const { name, email, contact, password } = req.body;

    const existingAdmin = await db.collection("admin register").findOne({
      $or: [{ email }, { contact }],
    });

    if (existingAdmin) {
      return res
        .status(400)
        .send({
          status: "fail",
          message: "Email or Contact already registered",
        });
    }

    await db
      .collection("admin register")
      .insertOne({ name, email, contact, password });

    res.send({ status: "success", message: "Admin registered successfully" });
  } catch (err) {
    res
      .status(500)
      .send({ status: "error", message: "Error registering admin" });
  }
});

app.post("/login-admin", async (req, res) => {
  try {
    const db = getDb();
    const { adminId, password } = req.body;

    const admin = await db.collection("admin register").findOne({
      $or: [{ email: adminId }, { contact: adminId }, { name: adminId }],
    });

    if (!admin || admin.password !== password) {
      return res
        .status(401)
        .send({ status: "fail", message: "Invalid credentials" });
    }

    res.send({
      status: "success",
      message: "Login successful",
      admin: {
        name: admin.name,
        email: admin.email,
        contact: admin.contact,
      },
    });
  } catch (err) {
    res
      .status(500)
      .send({ status: "error", message: "Server error during login" });
  }
});

// -----------------------------------
// Category APIs
// -----------------------------------

app.post("/add-category", async (req, res) => {
  try {
    const db = getDb();
    const { name } = req.body;

    const existing = await db.collection("categories").findOne({ name });
    if (existing)
      return res
        .status(400)
        .send({ status: "fail", message: "Category already exists" });

    await db.collection("categories").insertOne({ name, count: 0 });
    res.send({ status: "success", message: "Category added" });
  } catch (err) {
    res.status(500).send({ status: "error", message: "Server error" });
  }
});

app.get("/categories", async (req, res) => {
  try {
    const db = getDb();
    const categories = await db.collection("categories").find().toArray();
    res.send({ status: "success", data: categories });
  } catch (err) {
    res.status(500).send({ status: "error", message: "Server error" });
  }
});

app.get("/categories-with-count", async (req, res) => {
  try {
    const db = getDb();
    const categories = await db.collection("categories").find().toArray();
    res.send({ status: "success", data: categories });
  } catch (err) {
    res.status(500).send({ status: "error", message: "Server error" });
  }
});

// -----------------------------------
// Department APIs
// -----------------------------------

app.post("/add-department", async (req, res) => {
  try {
    const db = getDb();
    const {
      name,
      address,
      photo,
      photoAlt,
      category,
      noOfShifts,
      amountOfShift,
      keywords,
      maxEnroll,
      // New fields
      locationEmbed,
      shiftHours,
      shiftArea,
      shiftStartTime,
      shiftEndTime,
      shiftValidHours,
    } = req.body;

    await db.collection("departments").insertOne({
      name,
      address,
      photo,
      photoAlt,
      category,
      noOfShifts,
      amountOfShift,
      keywords,
      maxEnroll,
      // New fields
      locationEmbed,
      shiftHours,
      shiftArea,
      shiftStartTime,
      shiftEndTime,
      shiftValidHours,
      // Add timestamp for when the department was created
      createdAt: new Date(),
    });

    await db
      .collection("categories")
      .updateOne({ name: category }, { $inc: { count: 1 } });

    res.send({ status: "success", message: "Department added successfully" });
  } catch (err) {
    console.error("Error adding department:", err);
    res
      .status(500)
      .send({ status: "error", message: "Failed to add department" });
  }
});

app.get("/departments", async (req, res) => {
  try {
    const db = getDb();
    const departments = await db.collection("departments").find().toArray();

    // Process departments to add calculated fields like remaining time
    const processedDepartments = departments.map((dept) => {
      // If we have the necessary fields to calculate shift expiry
      if (dept.shiftStartTime && dept.shiftValidHours) {
        const now = new Date();
        const shiftStart = new Date(dept.createdAt);

        // Parse time strings (assuming format like "09:00" for 9 AM)
        if (dept.shiftStartTime.includes(":")) {
          const [hours, minutes] = dept.shiftStartTime.split(":").map(Number);
          shiftStart.setHours(hours, minutes, 0, 0);
        }

        // Calculate if shift is expired
        const validUntil = new Date(shiftStart);
        validUntil.setHours(
          validUntil.getHours() + parseInt(dept.shiftValidHours)
        );

        dept.isExpired = now > validUntil;
        dept.remainingTime = Math.max(
          0,
          (validUntil - now) / (1000 * 60 * 60)
        ).toFixed(1); // in hours
      }

      return dept;
    });

    res.send({ status: "success", data: processedDepartments });
  } catch (err) {
    console.error("Error fetching departments:", err);
    res
      .status(500)
      .send({ status: "error", message: "Failed to fetch departments" });
  }
});

app.delete("/delete-department/:id", async (req, res) => {
  try {
    const db = getDb();
    const departmentId = req.params.id;

    const department = await db
      .collection("departments")
      .findOne({ _id: new ObjectId(departmentId) });
    if (!department)
      return res
        .status(404)
        .send({ status: "fail", message: "Department not found" });

    await db
      .collection("departments")
      .deleteOne({ _id: new ObjectId(departmentId) });
    await db
      .collection("categories")
      .updateOne({ name: department.category }, { $inc: { count: -1 } });

    res.send({ status: "success", message: "Department deleted" });
  } catch (err) {
    console.error("Error deleting department:", err);
    res
      .status(500)
      .send({ status: "error", message: "Failed to delete department" });
  }
});

app.put("/update-department/:id", async (req, res) => {
  try {
    const db = getDb();
    const departmentId = req.params.id;
    const updatedData = req.body;

    const department = await db
      .collection("departments")
      .findOne({ _id: new ObjectId(departmentId) });
    if (!department)
      return res
        .status(404)
        .send({ status: "fail", message: "Department not found" });

    const categoryChanged = department.category !== updatedData.category;

    // If we're updating shift-related fields, update the timestamp
    if (
      updatedData.shiftStartTime !== department.shiftStartTime ||
      updatedData.shiftEndTime !== department.shiftEndTime ||
      updatedData.shiftValidHours !== department.shiftValidHours
    ) {
      updatedData.updatedAt = new Date();
    }

    await db
      .collection("departments")
      .updateOne({ _id: new ObjectId(departmentId) }, { $set: updatedData });

    if (categoryChanged) {
      await db
        .collection("categories")
        .updateOne({ name: department.category }, { $inc: { count: -1 } });
      await db
        .collection("categories")
        .updateOne({ name: updatedData.category }, { $inc: { count: 1 } });
    }

    res.send({ status: "success", message: "Department updated" });
  } catch (err) {
    console.error("Error updating department:", err);
    res
      .status(500)
      .send({ status: "error", message: "Failed to update department" });
  }
});

// -----------------------------------
// Department Dashboard APIs
// -----------------------------------

// Update the department-login endpoint to include a token
app.post("/department-login", async (req, res) => {
  try {
    const db = getDb();
    const { email, password } = req.body;

    console.log(`Login attempt for email: ${email}`);

    // Find department member by email
    const member = await db.collection("departmentMembers").findOne({ email });

    // Check if member exists
    if (!member) {
      console.log(`No member found with email: ${email}`);
      return res.status(401).json({
        status: "error",
        message: "Invalid email or password",
      });
    }

    console.log(`Found member: ${member._id}, status: ${member.status}`);

    // Check if member is active
    if (member.status !== "active") {
      return res.status(403).json({
        status: "error",
        message: "Your account is inactive. Please contact administrator.",
      });
    }

    // Check password (in a real app, you should use bcrypt.compare)
    if (member.password !== password) {
      console.log("Password mismatch");
      return res.status(401).json({
        status: "error",
        message: "Invalid email or password",
      });
    }

    // Remove password from response
    const { password: memberPassword, ...memberData } = member;

    // Generate a token for the department member
    const token = jwt.sign(
      { userId: member._id, email: member.email },
      secretKey,
      { expiresIn: "1h" }
    );

    console.log(`Login successful for member ID: ${member._id}`);

    res.json({
      status: "success",
      message: "Login successful",
      token: token,
      data: {
        ...memberData,
        _id: member._id.toString(), // Convert ObjectId to string
        departmentId: member.departmentId || member._id.toString(), // Include explicit departmentId
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      status: "error",
      message: "Error processing login",
    });
  }
});

// Get department data endpoint
app.get("/departments/:id", async (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;

    console.log("Requested department ID:", id);

    // Make sure to handle potential ObjectId conversion errors
    let objectId;
    try {
      objectId = new ObjectId(id);
    } catch (error) {
      console.error("Invalid ID format:", id, error);
      return res.status(400).json({
        status: "error",
        message: "Invalid department ID format",
      });
    }

    // Find department by ID
    const department = await db.collection("departments").findOne({
      _id: objectId,
    });

    if (!department) {
      console.log("Department not found for ID:", id);
      return res.status(404).json({
        status: "error",
        message: "Department not found",
      });
    }

    console.log(`Found department: ${department.name} (${department._id})`);

    res.json({
      status: "success",
      data: department,
    });
  } catch (error) {
    console.error("Error fetching department:", error);
    res.status(500).json({
      status: "error",
      message: "Error fetching department: " + error.message,
    });
  }
});

// Update permanent slab endpoint
app.post("/update-permanent-slab", async (req, res) => {
  try {
    const db = getDb();
    const { departmentId, purpose, numberOfHours, timerLabel, timerHours } =
      req.body;

    console.log("Updating permanent slab for department:", departmentId);

    let objectId;
    try {
      objectId = new ObjectId(departmentId);
    } catch (error) {
      console.error("Invalid department ID format:", departmentId);
      return res.status(400).json({
        status: "error",
        message: "Invalid department ID format",
      });
    }

    // Update permanent slab for department
    const result = await db.collection("departments").updateOne(
      { _id: objectId },
      {
        $set: {
          permanentSlab: {
            purpose,
            numberOfHours,
            timer: {
              label: timerLabel,
              hours: timerHours,
            },
            updatedAt: new Date(),
          },
        },
      }
    );

    if (result.matchedCount === 0) {
      console.log("Department not found for ID:", departmentId);
      return res.status(404).json({
        status: "error",
        message: "Department not found",
      });
    }

    console.log("Permanent slab updated successfully");

    res.json({
      status: "success",
      message: "Permanent slab updated successfully",
    });
  } catch (error) {
    console.error("Error updating permanent slab:", error);
    res.status(500).json({
      status: "error",
      message: "Error updating permanent slab: " + error.message,
    });
  }
});

// Submit temporary slab endpoint
app.post("/submit-temporary-slab", async (req, res) => {
  try {
    const db = getDb();
    const { departmentId, note, validHours, timerLabel, timerHours } = req.body;

    console.log("Submitting temporary slab for department:", departmentId);

    let objectId;
    try {
      objectId = new ObjectId(departmentId);
    } catch (error) {
      console.error("Invalid department ID format:", departmentId);
      return res.status(400).json({
        status: "error",
        message: "Invalid department ID format",
      });
    }

    // Create new temporary slab for department
    const temporarySlab = {
      _id: new ObjectId(),
      departmentId: objectId,
      note,
      validHours,
      timer: {
        label: timerLabel,
        hours: timerHours,
      },
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + parseInt(validHours) * 60 * 60 * 1000),
    };

    // Insert temporary slab
    const result = await db
      .collection("temporarySlabs")
      .insertOne(temporarySlab);

    console.log(
      "Temporary slab submitted successfully with ID:",
      result.insertedId
    );

    res.json({
      status: "success",
      message: "Temporary slab submitted successfully",
      data: {
        _id: result.insertedId.toString(),
      },
    });
  } catch (error) {
    console.error("Error submitting temporary slab:", error);
    res.status(500).json({
      status: "error",
      message: "Error submitting temporary slab: " + error.message,
    });
  }
});

// Get all department members
app.get("/department-members", async (req, res) => {
  try {
    const db = getDb();
    const members = await db.collection("departmentMembers").find().toArray();

    // Convert ObjectId to string for each member
    const processedMembers = members.map((member) => ({
      ...member,
      _id: member._id.toString(),
    }));

    res.json({
      status: "success",
      data: processedMembers,
    });
  } catch (error) {
    console.error("Error fetching department members:", error);
    res.status(500).json({
      status: "error",
      message: "Error fetching department members",
    });
  }
});

// Add a department member
app.post("/add-department-member", async (req, res) => {
  try {
    const db = getDb();
    const {
      fullname,
      email,
      contact,
      department,
      password,
      joiningDate,
      status,
      canEditDetails,
    } = req.body;

    // Check if email already exists
    const existingMember = await db
      .collection("departmentMembers")
      .findOne({ email });
    if (existingMember) {
      return res.status(400).json({
        status: "error",
        message: "Email already exists",
      });
    }

    const newMember = {
      fullname,
      email,
      contact,
      department,
      password,
      joiningDate: new Date(joiningDate),
      status,
      canEditDetails,
      createdAt: new Date(),
    };

    const result = await db
      .collection("departmentMembers")
      .insertOne(newMember);

    res.json({
      status: "success",
      message: "Department member added successfully",
      data: {
        _id: result.insertedId.toString(),
        ...newMember,
      },
    });
  } catch (error) {
    console.error("Error adding department member:", error);
    res.status(500).json({
      status: "error",
      message: "Error adding department member",
    });
  }
});

// Update a department member
app.put("/update-department-member/:id", async (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const {
      fullname,
      email,
      contact,
      department,
      password,
      joiningDate,
      status,
      canEditDetails,
      socialMediaLinks,
      address,
    } = req.body;

    let objectId;
    try {
      objectId = new ObjectId(id);
    } catch (error) {
      return res.status(400).json({
        status: "error",
        message: "Invalid member ID format",
      });
    }

    // Check if email exists but belongs to a different member
    const existingMember = await db.collection("departmentMembers").findOne({
      email,
      _id: { $ne: objectId },
    });

    if (existingMember) {
      return res.status(400).json({
        status: "error",
        message: "Email already exists",
      });
    }

    const updatedMemberData = {
      fullname,
      email,
      contact,
      department,
      socialMediaLinks,
      address,
      updatedAt: new Date(),
    };

    // Only update password if provided
    if (password) {
      updatedMemberData.password = password;
    }

    // Only update joiningDate if provided
    if (joiningDate) {
      updatedMemberData.joiningDate = new Date(joiningDate);
    }

    // Only update status if provided
    if (status) {
      updatedMemberData.status = status;
    }

    // Only update canEditDetails if provided
    if (canEditDetails !== undefined) {
      updatedMemberData.canEditDetails = canEditDetails;
    }

    const result = await db
      .collection("departmentMembers")
      .updateOne({ _id: objectId }, { $set: updatedMemberData });

    if (result.matchedCount === 0) {
      return res.status(404).json({
        status: "error",
        message: "Department member not found",
      });
    }

    res.json({
      status: "success",
      message: "Department member updated successfully",
    });
  } catch (error) {
    console.error("Error updating department member:", error);
    res.status(500).json({
      status: "error",
      message: "Error updating department member",
    });
  }
});

// Delete a department member
app.delete("/delete-department-member/:id", async (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;

    let objectId;
    try {
      objectId = new ObjectId(id);
    } catch (error) {
      return res.status(400).json({
        status: "error",
        message: "Invalid member ID format",
      });
    }

    const result = await db.collection("departmentMembers").deleteOne({
      _id: objectId,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        status: "error",
        message: "Department member not found",
      });
    }

    res.json({
      status: "success",
      message: "Department member deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting department member:", error);
    res.status(500).json({
      status: "error",
      message: "Error deleting department member",
    });
  }
});

// Get active temporary slabs for a department
app.get("/temporary-slabs/:departmentId", async (req, res) => {
  try {
    const db = getDb();
    const { departmentId } = req.params;

    console.log("Fetching temporary slabs for department:", departmentId);

    let objectId;
    try {
      objectId = new ObjectId(departmentId);
    } catch (error) {
      console.error("Invalid department ID format:", departmentId);
      return res.status(400).json({
        status: "error",
        message: "Invalid department ID format",
      });
    }

    // Find active temporary slabs
    const temporarySlabs = await db
      .collection("temporarySlabs")
      .find({
        departmentId: objectId,
        expiresAt: { $gt: new Date() },
      })
      .sort({ createdAt: -1 })
      .toArray();

    // Convert ObjectId to strings for each slab
    const processedSlabs = temporarySlabs.map((slab) => ({
      ...slab,
      _id: slab._id.toString(),
      departmentId: slab.departmentId.toString(),
    }));

    console.log(`Found ${processedSlabs.length} active temporary slabs`);

    res.json({
      status: "success",
      data: processedSlabs,
    });
  } catch (error) {
    console.error("Error fetching temporary slabs:", error);
    res.status(500).json({
      status: "error",
      message: "Error fetching temporary slabs: " + error.message,
    });
  }
});

// Delete a temporary slab
app.delete("/temporary-slabs/:id", async (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;

    let objectId;
    try {
      objectId = new ObjectId(id);
    } catch (error) {
      return res.status(400).json({
        status: "error",
        message: "Invalid slab ID format",
      });
    }

    const result = await db.collection("temporarySlabs").deleteOne({
      _id: objectId,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        status: "error",
        message: "Temporary slab not found",
      });
    }

    res.json({
      status: "success",
      message: "Temporary slab deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting temporary slab:", error);
    res.status(500).json({
      status: "error",
      message: "Error deleting temporary slab: " + error.message,
    });
  }
});

// Get department statistics
app.get("/department-statistics/:departmentId", async (req, res) => {
  try {
    const db = getDb();
    const { departmentId } = req.params;

    console.log("Fetching statistics for department:", departmentId);

    let objectId;
    try {
      objectId = new ObjectId(departmentId);
    } catch (error) {
      console.error("Invalid department ID format:", departmentId);
      return res.status(400).json({
        status: "error",
        message: "Invalid department ID format",
      });
    }

    // Get department details
    const department = await db.collection("departments").findOne({
      _id: objectId,
    });

    if (!department) {
      console.log("Department not found for ID:", departmentId);
      return res.status(404).json({
        status: "error",
        message: "Department not found",
      });
    }

    // Count active members
    const activeMembers = await db
      .collection("departmentMembers")
      .countDocuments({
        department: department.name,
        status: "active",
      });

    // Count active temporary slabs
    const activeSlabs = await db.collection("temporarySlabs").countDocuments({
      departmentId: objectId,
      expiresAt: { $gt: new Date() },
    });

    // Get total hours allocated
    const totalHours = department.permanentSlab
      ? department.permanentSlab.numberOfHours
      : 0;

    console.log(
      `Statistics: ${activeMembers} members, ${activeSlabs} slabs, ${totalHours} hours`
    );

    res.json({
      status: "success",
      data: {
        departmentName: department.name,
        activeMembers,
        activeSlabs,
        totalHours,
      },
    });
  } catch (error) {
    console.error("Error fetching department statistics:", error);
    res.status(500).json({
      status: "error",
      message: "Error fetching department statistics: " + error.message,
    });
  }
});
  

app.get("/employees", async (req, res) => {
  try {
    const db = getDb();
    const users = await db.collection("employee register").find().toArray();
    res.send({ status: "success", data: users });
  } catch (err) {
    console.error(err);
    res.status(500).send({ status: "fail", message: "Error fetching users" });
  }
});

app.post("/add-employee", async (req, res) => {
  const db = getDb();
  const collection = db.collection("employee register");

  const { fullname, email, contact, password, address } = req.body;

  if (!fullname || !email || !contact || !password || !address) {
    return res.json({ status: "error", message: "All fields are required" });
  }

  try {
    const existingUser = await collection.findOne({ email });
    if (existingUser) {
      return res.json({
        status: "error",
        message: "User already exists with this email",
      });
    }

    const newUser = {
      fullname,
      email,
      contact,
      password,
      address,
      numberOfShifts: 0,
      walletBalance: 0,  // Initialize wallet balance
      createdAt: new Date(),
    };

    await collection.insertOne(newUser);

    res.json({ status: "success", message: "User created successfully" });
  } catch (err) {
    console.error("Error adding employee:", err);
    res.status(500).json({ status: "error", message: "Internal server error" });
  }
});

app.put("/update-employee/:id", async (req, res) => {
  try {
    const db = getDb();
    const employeeId = req.params.id;
    const { fullname, email, contact, password, address } = req.body;

    const existingWithEmail = await db.collection("employee register").findOne({
      email,
      _id: { $ne: new ObjectId(employeeId) },
    });

    if (existingWithEmail) {
      return res.status(400).send({
        status: "fail",
        message: "This email is already in use by another employee",
      });
    }

    const result = await db
      .collection("employee register")
      .updateOne(
        { _id: new ObjectId(employeeId) },
        {
          $set: {
            fullname,
            email,
            contact,
            password,
            address,
            updatedAt: new Date(),
          },
        }
      );

    if (result.matchedCount === 0) {
      return res
        .status(404)
        .send({ status: "fail", message: "Employee not found" });
    }

    res.send({ status: "success", message: "Employee updated successfully" });
  } catch (err) {
    console.error("Error updating employee:", err);
    res
      .status(500)
      .send({ status: "error", message: "Failed to update employee" });
  }
});

app.delete("/delete-employee/:id", async (req, res) => {
  try {
    const db = getDb();
    const employeeId = req.params.id;

    const result = await db.collection("employee register").deleteOne({
      _id: new ObjectId(employeeId),
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({
        status: "fail",
        message: "Employee not found or already deleted",
      });
    }

    res.send({ status: "success", message: "Employee deleted successfully" });
  } catch (err) {
    console.error("Error deleting employee:", err);
    res
      .status(500)
      .send({ status: "error", message: "Failed to delete employee" });
  }
});

app.post("/block-employee/:id", async (req, res) => {
  try {
    const db = getDb();
    const employeeId = req.params.id;
    const { blockReason, blockedAt } = req.body;

    const employee = await db.collection("employee register").findOne({
      _id: new ObjectId(employeeId),
    });

    if (!employee) {
      return res.status(404).send({
        status: "fail",
        message: "Employee not found",
      });
    }

    const result = await db.collection("employee register").updateOne(
      { _id: new ObjectId(employeeId) },
      {
        $set: {
          isBlocked: true,
          status: "Inactive",
          blockReason: blockReason || "",
          blockedAt: blockedAt || new Date().toISOString(),
          updatedAt: new Date(),
        },
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(400).send({
        status: "fail",
        message: "Failed to block employee",
      });
    }

    res.send({
      status: "success",
      message: "Employee blocked successfully",
    });
  } catch (err) {
    console.error("Error blocking employee:", err);
    res.status(500).send({
      status: "error",
      message: "Failed to block employee",
    });
  }
});

app.post("/unblock-employee/:id", async (req, res) => {
  try {
    const db = getDb();
    const employeeId = req.params.id;
    const { status } = req.body;

    const employee = await db.collection("employee register").findOne({
      _id: new ObjectId(employeeId),
    });

    if (!employee) {
      return res.status(404).send({
        status: "fail",
        message: "Employee not found",
      });
    }

    const result = await db.collection("employee register").updateOne(
      { _id: new ObjectId(employeeId) },
      {
        $set: {
          isBlocked: false,
          status: status || "Active",
          blockReason: "",
          blockedAt: null,
          updatedAt: new Date(),
        },
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(400).send({
        status: "fail",
        message: "Failed to unblock employee",
      });
    }

    res.send({
      status: "success",
      message: "Employee unblocked successfully",
    });
  } catch (err) {
    console.error("Error unblocking employee:", err);
    res.status(500).send({
      status: "error",
      message: "Failed to unblock employee",
    });
  }
});

app.get("/blocked-employees", async (req, res) => {
  try {
    const db = getDb();

    const blockedEmployees = await db
      .collection("employee register")
      .find({ isBlocked: true })
      .toArray();

    res.send({
      status: "success",
      data: blockedEmployees,
      count: blockedEmployees.length,
    });
  } catch (err) {
    console.error("Error fetching blocked employees:", err);
    res.status(500).send({
      status: "error",
      message: "Failed to fetch blocked employees",
    });
  }
});

app.post('/add-recharge-plan', async (req, res) => {
  try {
    const db = getDb();

    const {
      planName,
      amount,
      numberOfShifts,
      description
    } = req.body;

    if (!planName || !amount || !numberOfShifts) {
      return res.status(400).send({
        status: "error",
        message: "Please provide all required fields: planName, amount, numberOfShifts"
      });
    }

    await db.collection('rechargePlans').insertOne({
      planName,
      amount,
      numberOfShifts,
      description,
      createdAt: new Date()
    });

    res.send({
      status: "success",
      message: "Recharge plan added successfully"
    });

  } catch (err) {
    console.error('Error adding recharge plan:', err);
    res.status(500).send({
      status: "error",
      message: "Failed to add recharge plan"
    });
  }
});


app.get("/recharge-plans", async (req, res) => {
  try {
    const db = getDb();
    const plans = await db
      .collection("rechargePlans")
      .find()
      .sort({ createdAt: -1 })
      .toArray();

    res.send({
      status: "success",
      data: plans,
    });
  } catch (err) {
    console.error("Error fetching recharge plans:", err);
    res.status(500).send({
      status: "error",
      message: "Failed to get recharge plans",
    });
  }
});

app.post('/api/add-user-amount', async (req, res) => {
  const { userId, amount } = req.body;

  try {
    const db = getDb();
    await db.collection("employee register").updateOne(
      { _id: new ObjectId(userId) },
      { $inc: { walletBalance: Number(amount) } } // Updated to use walletBalance
    );
    res.send({ status: "success", message: "Amount added successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).send({ status: "fail", message: "Error adding amount" });
  }
});

// Add Notification
app.post('/api/add-notification', async (req, res) => {
  const { title, description } = req.body;

  try {
    const db = getDb();
    await db.collection('notifications').insertOne({
      title,
      description,
      createdAt: new Date()
    });

    res.status(201).send({ status: 'success', message: 'Notification added successfully' });
  } catch (err) {
    console.error('Add Notification Error:', err);
    res.status(500).send({ status: 'fail', message: 'Error adding notification' });
  }
});

// Get All Notifications
app.get('/api/notifications', async (req, res) => {
  try {
    const db = getDb();
    const notifications = await db.collection('notifications')
      .find()
      .sort({ createdAt: -1 })
      .toArray();

    res.send({ status: 'success', data: notifications });
  } catch (err) {
    console.error('Get Notifications Error:', err);
    res.status(500).send({ status: 'fail', message: 'Error fetching notifications' });
  }
});

// Edit Notification
app.put('/api/edit-notification/:id', async (req, res) => {
  const { id } = req.params;
  const { title, description } = req.body;

  try {
    const db = getDb();
    await db.collection('notifications').updateOne(
      { _id: new ObjectId(id) },
      { $set: { title, description, updatedAt: new Date() } }
    );

    res.send({ status: 'success', message: 'Notification updated successfully' });
  } catch (err) {
    console.error('Edit Notification Error:', err);
    res.status(500).send({ status: 'fail', message: 'Error updating notification' });
  }
});

// Delete Notification
app.delete('/api/delete-notification/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const db = getDb();
    await db.collection('notifications').deleteOne({ _id: new ObjectId(id) });

    res.send({ status: 'success', message: 'Notification deleted successfully' });
  } catch (err) {
    console.error('Delete Notification Error:', err);
    res.status(500).send({ status: 'fail', message: 'Error deleting notification' });
  }
});

// -----------------------------------
// Wishlist APIs
// -----------------------------------

// Create Wishlist Schema (MongoDB will create it automatically)

// 1. Add item to wishlist
app.post('/add-to-wishlist', verifyToken, async (req, res) => {
  try {
    const db = getDb();
    const { userId, itemId } = req.body;
    
    // Verify that the request is for the authenticated user
    if (req.user.userId.toString() !== userId) {
      return res.status(403).json({
        status: "error",
        message: "Unauthorized: You can only modify your own wishlist"
      });
    }
    
    // Check if item already exists in wishlist
    const existingItem = await db.collection("wishlist").findOne({ 
      userId: new ObjectId(userId), 
      itemId: new ObjectId(itemId) 
    });
    
    if (existingItem) {
      return res.status(200).json({
        status: "success",
        message: "Item is already in wishlist"
      });
    }
    
    // Create new wishlist item
    const wishlistItem = {
      userId: new ObjectId(userId),
      itemId: new ObjectId(itemId),
      addedAt: new Date()
    };
    
    await db.collection("wishlist").insertOne(wishlistItem);
    
    res.status(201).json({
      status: "success",
      message: "Item added to wishlist successfully",
      wishlistItem: {
        ...wishlistItem,
        userId: wishlistItem.userId.toString(),
        itemId: wishlistItem.itemId.toString()
      }
    });
  } catch (error) {
    console.error('Error adding to wishlist:', error);
    res.status(500).json({
      status: "error",
      message: "An error occurred while adding to wishlist",
      error: error.message
    });
  }
});

// 2. Remove item from wishlist
app.post('/remove-from-wishlist', verifyToken, async (req, res) => {
  try {
    const db = getDb();
    const { userId, itemId } = req.body;
    
    // Verify that the request is for the authenticated user
    if (req.user.userId.toString() !== userId) {
      return res.status(403).json({
        status: "error",
        message: "Unauthorized: You can only modify your own wishlist"
      });
    }
    
    // Find and delete the wishlist item
    const result = await db.collection("wishlist").deleteOne({ 
      userId: new ObjectId(userId), 
      itemId: new ObjectId(itemId) 
    });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({
        status: "error",
        message: "Wishlist item not found"
      });
    }
    
    res.status(200).json({
      status: "success",
      message: "Item removed from wishlist successfully"
    });
  } catch (error) {
    console.error('Error removing from wishlist:', error);
    res.status(500).json({
      status: "error",
      message: "An error occurred while removing from wishlist",
      error: error.message
    });
  }
});

// 3. Get user's wishlist
app.get('/get-wishlist/:userId', verifyToken, async (req, res) => {
  try {
    const db = getDb();
    const { userId } = req.params;
    
    // Verify that the request is for the authenticated user
    if (req.user.userId.toString() !== userId) {
      return res.status(403).json({
        status: "error",
        message: "Unauthorized: You can only view your own wishlist"
      });
    }
    
    // Find all wishlist items for the user
    const wishlistItems = await db.collection("wishlist")
      .find({ userId: new ObjectId(userId) })
      .sort({ addedAt: -1 })
      .toArray();
    
    // Convert ObjectIds to strings for the response
    const formattedWishlist = wishlistItems.map(item => ({
      ...item,
      _id: item._id.toString(),
      userId: item.userId.toString(),
      itemId: item.itemId.toString()
    }));
    
    res.status(200).json({
      status: "success",
      wishlist: formattedWishlist,
      count: formattedWishlist.length
    });
  } catch (error) {
    console.error('Error fetching wishlist:', error);
    res.status(500).json({
      status: "error",
      message: "An error occurred while fetching wishlist",
      error: error.message
    });
  }
});

// 4. Check if item is in wishlist
app.get('/check-wishlist/:userId/:itemId', verifyToken, async (req, res) => {
  try {
    const db = getDb();
    const { userId, itemId } = req.params;
    
    // Verify that the request is for the authenticated user
    if (req.user.userId.toString() !== userId) {
      return res.status(403).json({
        status: "error",
        message: "Unauthorized: You can only check your own wishlist"
      });
    }
    
    // Check if the item exists in the user's wishlist
    const wishlistItem = await db.collection("wishlist").findOne({ 
      userId: new ObjectId(userId), 
      itemId: new ObjectId(itemId) 
    });
    
    res.status(200).json({
      status: "success",
      isInWishlist: wishlistItem ? true : false
    });
  } catch (error) {
    console.error('Error checking wishlist:', error);
    res.status(500).json({
      status: "error",
      message: "An error occurred while checking wishlist",
      error: error.message
    });
  }
});

// 5. Get wishlist with populated department details
app.get('/get-wishlist-details/:userId', verifyToken, async (req, res) => {
  try {
    const db = getDb();
    const { userId } = req.params;
    
    // Verify that the request is for the authenticated user
    if (req.user.userId.toString() !== userId) {
      return res.status(403).json({
        status: "error",
        message: "Unauthorized: You can only view your own wishlist"
      });
    }
    
    // Find all wishlist items for the user
    const wishlistItems = await db.collection("wishlist")
      .find({ userId: new ObjectId(userId) })
      .sort({ addedAt: -1 })
      .toArray();
    
    // Extract all item IDs
    const itemIds = wishlistItems.map(item => item.itemId);
    
    // Fetch department details for each item ID
    const departments = await db.collection("departments")
      .find({ _id: { $in: itemIds } })
      .toArray();
    
    // Combine wishlist data with department details
    const detailedWishlist = wishlistItems.map(item => {
      const department = departments.find(dept => 
        dept._id.toString() === item.itemId.toString()
      );
      
      return {
        wishlistId: item._id.toString(),
        userId: item.userId.toString(),
        itemId: item.itemId.toString(),
        addedAt: item.addedAt,
        department: department || null
      };
    });
    
    res.status(200).json({
      status: "success",
      wishlist: detailedWishlist,
      count: detailedWishlist.length
    });
  } catch (error) {
    console.error('Error fetching wishlist details:', error);
    res.status(500).json({
      status: "error",
      message: "An error occurred while fetching wishlist details",
      error: error.message
    });
  }
});

// 6. Get all user's wishlisted department IDs (simplified endpoint for Department component)
app.get('/get-wishlisted-ids/:userId', verifyToken, async (req, res) => {
  try {
    const db = getDb();
    const { userId } = req.params;
    
    // Verify that the request is for the authenticated user
    if (req.user.userId.toString() !== userId) {
      return res.status(403).json({
        status: "error",
        message: "Unauthorized: You can only access your own wishlist"
      });
    }
    
    // Find all wishlist items for the user and only select itemId
    const wishlistItems = await db.collection("wishlist")
      .find({ userId: new ObjectId(userId) })
      .project({ itemId: 1, _id: 0 })
      .toArray();
    
    // Extract and format item IDs
    const wishlistedIds = wishlistItems.map(item => item.itemId.toString());
    
    res.status(200).json({
      status: "success",
      wishlistedIds: wishlistedIds
    });
  } catch (error) {
    console.error('Error fetching wishlisted IDs:', error);
    res.status(500).json({
      status: "error",
      message: "An error occurred while fetching wishlisted IDs",
      error: error.message
    });
  }
});

// 7. Get wishlist count for a user
app.get('/get-wishlist-count/:userId', verifyToken, async (req, res) => {
  try {
    const db = getDb();
    const { userId } = req.params;
    
    // Verify that the request is for the authenticated user
    if (req.user.userId.toString() !== userId) {
      return res.status(403).json({
        status: "error",
        message: "Unauthorized: You can only access your own wishlist"
      });
    }
    
    // Count wishlist items for the user
    const count = await db.collection("wishlist").countDocuments({ 
      userId: new ObjectId(userId) 
    });
    
    res.status(200).json({
      status: "success",
      count: count
    });
  } catch (error) {
    console.error('Error fetching wishlist count:', error);
    res.status(500).json({
      status: "error",
      message: "An error occurred while fetching wishlist count",
      error: error.message
    });
  }
});

// 8. Clear all items from wishlist
app.delete('/clear-wishlist/:userId', verifyToken, async (req, res) => {
  try {
    const db = getDb();
    const { userId } = req.params;
    
    // Verify that the request is for the authenticated user
    if (req.user.userId.toString() !== userId) {
      return res.status(403).json({
        status: "error",
        message: "Unauthorized: You can only modify your own wishlist"
      });
    }
    
    // Delete all wishlist items for the user
    const result = await db.collection("wishlist").deleteMany({ 
      userId: new ObjectId(userId) 
    });
    
    res.status(200).json({
      status: "success",
      message: "Wishlist cleared successfully",
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error clearing wishlist:', error);
    res.status(500).json({
      status: "error",
      message: "An error occurred while clearing wishlist",
      error: error.message
    });
  }
});


// -----------------------------------
// Health Check
// -----------------------------------

app.get("/", (req, res) => {
 res.json({
  status:true
 })
});

mongoConnect(() => {
  app.listen(port, () => {
    console.log(`🚀 Server started on http://localhost:${port}`);
  });
});


