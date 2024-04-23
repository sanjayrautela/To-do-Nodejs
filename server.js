const express = require("express");
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const mongodbSession = require("connect-mongodb-session")(session);

//file-import
const { userDataValidation, isEmailRgex } = require("./utils/authutils");
const userModel = require("./models/usermodel");
const { isAuth } = require("./middleware/isAuth");
const { todoDataValidation } = require("./utils/todoutlis");
const todoModel = require("./models/todomodel");
const todomodel = require("./models/todomodel");
const rateLimiting = require("./middleware/ratelimiting");

//constants
const app = express();
const PORT = process.env.PORT || 8000;
const store = new mongodbSession({
    uri: process.env.MONGO_URI,
    collection: "sessions",
});
const Schema = mongoose.Schema;

//db connection
mongoose
    .connect(process.env.MONGO_URI)
    .then(() => {
        console.log("Mongodb connected successfully");
    })
    .catch((err) => {
        console.log(err);
    });

//middlewares
app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
    session({
        secret: process.env.SECRET_KEY,
        store: store,
        resave: false,
        saveUninitialized: false,
    })
);

app.use(express.static("public"));

app.get("/", (req, res) => {
    return res.render("server");
});

app.get("/register", (req, res) => {
    return res.render("registerPage");
});

app.post("/register-user", async (req, res) => {
    const { name, email, username, password } = req.body;

    //data validation
    try {
        await userDataValidation({ name, username, password, email });
    } catch (error) {
        return res.send({
            status: 400,
            error: error,
        });
    }

    try {
        //check is email exist
        const isEmailExist = await userModel.findOne({ email });
        if (isEmailExist) {
            return res.status(400).json("Email already exist");
        }

        //check if username exist

        const isUsernameExist = await userModel.findOne({ username });
        if (isUsernameExist) {
            return res.status(400).json("Username already exist");
        }

        //hashing of the password
        const hashedPassword = await bcrypt.hash(
            password,
            Number(process.env.SALT)
        );

        const userObj = new userModel({
            name: name,
            email: email,
            username: username,
            password: hashedPassword,
        });

        //store the data
        const userDb = await userObj.save();

        return res.redirect("/login");
    } catch (error) {
        return res.send({
            status: 500,
            message: "Internal server error",
            error: error,
        });
    }
});

app.get("/login", (req, res) => {
    return res.render("loginPage");
});

app.post("/login-user", async (req, res) => {
    console.log(req.body);

    const { loginId, password } = req.body;

    if (!loginId || !password) return res.status(400).json("Missing credentials");

    let userDb;
    try {
        //find the user with loginId
        if (isEmailRgex({ str: loginId })) {
            userDb = await userModel.findOne({ email: loginId });
        } else {
            userDb = await userModel.findOne({ username: loginId });
        }
        console.log(userDb);

        if (!userDb) {
            return res.send({
                status: 400,
                message: "User not found, please register first",
            });
        }

        //compare the password

        const isMatched = await bcrypt.compare(password, userDb.password);

        if (!isMatched) {
            return res.send({
                status: 400,
                message: "Password is incorrect",
            });
        }

        //session base auth

        console.log(req.session);
        req.session.isAuth = true;
        req.session.user = {
            username: userDb.username,
            email: userDb.email,
            userId: userDb._id,
        };

        return res.redirect("/dashboard");
    } catch (error) {
        return res.send({
            status: 500,
            message: "Internal server error",
            error: error,
        });
    }
});

app.get("/dashboard", isAuth, (req, res) => {
    return res.render("dashboard");
});

app.post("/logout", isAuth, (req, res) => {
    console.log(req.session);
    req.session.destroy((err) => {
        if (err) throw err;
        console.log(req.session);

        return res.redirect("/login");
    });
});

app.post("/logout_from_all_devices", isAuth, async (req, res) => {
    console.log(req.session);

    const username = req.session.user.username;
    const sessionSchema = new Schema({ _id: String }, { strict: false });
    const sessionModel = mongoose.model("session", sessionSchema);

    try {
        const deleteDb = await sessionModel.deleteMany({
            "session.user.username": username,
        });

        console.log(deleteDb);

        return res.send({
            status: 200,
            message: "Logout from all devices successfull",
            data: deleteDb,
        });
    } catch (error) {
        return res.send({
            status: 500,
            error: error,
        });
    }
});

//creating todo api

// create
app.post("/create-item", isAuth, rateLimiting, async (req, res) => {
    console.log(req.body);

    const todoText = req.body.todo;
    const username = req.session.user.username

    try {
        await todoDataValidation({ todoText });
    } catch (error) {
        return res.send({
            status: 400,
            message: "data error",
            error: error,
        });
    }

    const todoObj = new todoModel({
        todo: todoText,
        username: username,
    });

    try {
        const todoDb = await todoObj.save();

        return res.send({
            status: 201,
            message: "todo created successfully",
            data: todoDb,
        });
    } catch (error) {
        return res.send({
            status: 500,
            message: "internal server error",
            error: error,
        });
    }
});

//read

app.get("/read-item", isAuth, async (req, res) => {
    const username = req.session.user.username;
    const SKIP = Number(req.query.skip) || 0;
    const LIMIT = 5;

    try {
        // const todoDb = await todoModel.find({ username });
        const todo = await todomodel.aggregate([
            {
                $match: { username: username},
            },
            {
                $skip: SKIP,
            },
            {
                $limit: LIMIT,
            }
        ]);

        console.log(todoDb);

        if (todoDb.length === 0) {
            return res.send({
                status: 204,
                message: "no todos found",
            });
        }

        return res.send({
            status: 200,
            message: "Read success",
            data: todoDb,
        });
    } catch (error) {
        return res.send({
            status: 500,
            message: "internal server error",
            error: error,
        })
    }
});

//edit 
app.post("/edit-item", isAuth, async (req, res) => {
    const { todoId, newData } = req.body;
    const username = req.session.user.username;

    if (!todoId) {
        return res.send({
            status: 400,
            message: "Missing todoId",
        });
    }

    try {
        await todoDataValidation({ todoText: newData });
    } catch (error) {
        return res.send({
            status: 400,
            error: error,
        });
    }

    //find the todo
    try {
        const todoDb = await todoModel.findOne({ _id: todoId });

        if (!todoDb) {
            return res.send({
                status: 203,
                message: `no todo found with todoId :${todoId}`,
            });
        }

        //compare the ownership
        if (username !== todoDb.username) {
            return res.send({
                status: 403,
                message: "not allowed to edit the todo",
            });
        }
        const prevTodo = await todoModel.findOneAndUpdate(
            { _id: todoId },
            { todo: newData }
        );
        return res.send({
            status: 200,
            message: "todo updated successfully",
            data: prevTodo,
        });
    } catch (error) {
        console.log(error);
        return res.send({
            status: 500,
            message: "internal server error",
            error: error,
        });
    }
});

//delete the todo

app.post("/delete-item", isAuth, async (req, res) => {
    const { todoId } = req.body;
    const username = req.session.user.username;

    if (!todoId) {
        return res.send({
            status: 400,
            message: "Missing todoId",
        });
    }

    // Find the todo
    try {
        const todoDb = await todoModel.findOne({ _id: todoId });

        if (!todoDb) {
            return res.send({
                status: 203,
                message: `No todo found with todoId: ${todoId}`,
            });
        }

        // Compare the ownership
        if (username !== todoDb.username) {
            return res.send({
                status: 403,
                message: "Not allowed to delete the todo",
            });
        }

        // Delete the todo
        await todoModel.findOneAndDelete({ _id: todoId });

        return res.send({
            status: 200,
            message: "Todo deleted successfully",
        });
    } catch (error) {
        console.log(error);
        return res.send({
            status: 500,
            message: "Internal server error",
            error: error,
        });
    }
});


app.listen(PORT, () => {
    console.log("Server is running:");
    console.log(`http://localhost:${PORT}/`);
});