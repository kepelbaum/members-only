/////// app.js

require('dotenv').config();
const express = require("express");
const path = require("path");
const session = require("express-session");
const MemoryStore = require('memorystore')(session);
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { body, validationResult } = require("express-validator");
const Schema = mongoose.Schema;
const asyncHandler = require("express-async-handler");
const { DateTime } = require("luxon");

const mongoDb = process.env.MONGODB_URI;
mongoose.connect(mongoDb);
const db = mongoose.connection;
db.on("error", console.error.bind(console, "mongo connection error"));

const User = mongoose.model(
  "User",
  new Schema({
    username: { type: String, required: true },
    password: { type: String, required: true },
    firstname: { type: String, required: true },
    lastname: { type: String, required: true },
    membership: {type: Boolean, required: true },
    admin: {type: Boolean, default: false },
  })
);



const PostSchema = mongoose.Schema({
    username: { type: String, required: true },
    content: {type: String, required: true},
    date: {type: Date, default: Date.now},
});
PostSchema.virtual("date_formatted").get(function () {
  return DateTime.fromJSDate(this.date).toISODate(); // format 'YYYY-MM-DD'
}); 

PostSchema.virtual("url").get(function () {
  return '/' + this.id;
}); 

const Post = mongoose.model('Post', PostSchema);

const app = express();
app.set("views", __dirname);
app.set("view engine", "ejs");
app.use(session({
  cookie: { maxAge: 86400000 },
  store: new MemoryStore({
    checkPeriod: 86400000 // prune expired entries every 24h
  }),
  resave: false,
  secret: 'keyboard cat',
  saveUninitialized: true 
}))
// app.use(session({ secret: "cats", resave: false, }));
app.use(passport.session());
app.use(express.urlencoded({ extended: false }));

app.get("/", asyncHandler( async (req, res, next) => {
    const allPosts = await Post.find({}).sort({date: -1}).exec();
    res.render("index", { user: req.user, posts: allPosts });
  })); 


app.get("/new", (req, res) => {
    res.render("post_form", { user: req.user, errors: false });
});

app.post("/new", 
body('message').custom(async value => {
  if (!value) {
    throw new Error("WRITE SOMETHING FIRST!");
    return false;
  }
  else {
    return true;
  }
}),
asyncHandler( async (req, res, next) => {
  try {
    const errors = await validationResult(req);
    if (!errors.isEmpty()) {
      res.render('post_form', {user: req.user, errors: errors.array()});
    } else {
      const post = new Post({
        username: req.user.username,
        content: req.body.message,
      });
      const result = await post.save();
        res.redirect('/');
    }
  } catch(err) {
    return next(err);
  };
}));

// <!-- <%{ for (const post in posts) {%>
//   <h1>Hello World!</h1>
// <%}%> -->

app.get("/trial", (req, res) => {
  res.render("trial-form", { user: req.user, errors: false });
});

app.post("/trial", 
body('trial').custom(async value => {
  if (value === 'catsarecool') {
    return true;
  }
  else {
    throw new Error("WRONG!");
    return false;
  }
}),
asyncHandler( async (req, res, next) => {
  try {
    const errors = await validationResult(req);
    if (!errors.isEmpty()) {
      res.render('trial-form', {errors: errors.array()});
    } else {
      const user = await User.findOneAndUpdate({username: req.user.username}, {membership: true});
      res.redirect('/');
    }
  } catch(err) {
    return next(err);
  };
}));

app.get("/sign-up", (req, res) => res.render("sign-up-form", {errors: false}));
app.post("/sign-up", 
body('username').custom(async value => {
    const user = await User.findOne({username: value}).exec();
    if (user) {
      throw new Error('Username is taken.');
      return false;
    }
    else {
      return true;
    }
}),
body('password').isLength({ min: 5 }).withMessage("Password has to be at least 5 symbols long"),
body('confirm').custom((value, { req }) => {
      if (value === req.body.password) return true;
      else throw new Error('Passwords do not match');
}),

asyncHandler( async (req, res, next) => {
    try {
      const errors = await validationResult(req);
      if (!errors.isEmpty()) {
        res.render('sign-up-form', {errors: errors.array()});
      } else {
        bcrypt.hash(req.body.password, 10, async (err, hashedPassword) => {
            const user = new User({
                username: req.body.username,
                password: hashedPassword,
                firstname: req.body.firstname,
                lastname: req.body.lastname,
                membership: false,
              });
              const result = await user.save();
              res.redirect("/");
        })
      }
    } catch(err) {
      return next(err);
    };
}));

passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await User.findOne({ username: username });
        if (!user) {
          return done(null, false, { message: "Incorrect username" });
        };
        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            // passwords do not match!
            return done(null, false, { message: "Incorrect password" })
          }
        return done(null, user);
      } catch(err) {
        return done(err);
      };
    })
  );
  
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });
  
  passport.deserializeUser(async (id, done) => {
    try {
      const user = await User.findById(id);
      done(null, user);
    } catch(err) {
      done(err);
    };
  });
  
  app.post(
    "/log-in",
    passport.authenticate("local", {
      successRedirect: "/",
      failureRedirect: "/"
    })
  );

  app.get("/log-out", (req, res, next) => {
    req.logout((err) => {
      if (err) {
        return next(err);
      }
      res.redirect("/");
    });
  });

  app.get("/error", (req, res) => res.render("error"));

  app.get("/:id", asyncHandler( async (req, res, next) => {
    if (req.user) {
      if (req.user.admin) {
        const post = await Post.findById(req.params.id).exec();
      if (!post) {
        res.redirect("/error");
      }
      else {
        res.render("delete-confirm", { user: req.user, errors: false, post: post, id: req.params.id });
      }
      }
      else {
        res.redirect("/error");
      }
    }
    else {
      res.redirect("/error");
    }
  })); 

  app.post("/:id", asyncHandler( async (req, res, next) => {
    const post = await Post.findByIdAndDelete(req.params.id).exec();
    res.redirect("/");
  })); 
  

app.listen(3000, () => console.log("app listening on port 3000!"));