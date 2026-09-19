/* ============================================================
   Raghuram Reddy portfolio — CMS layer
   Backend: Firebase (Auth + Firestore + Storage)
   Only the account matching ADMIN_EMAIL (see firebase-config.js)
   can add, edit, delete, or upload anything. Everyone else gets
   read-only access, enforced by Firestore/Storage security rules
   (not just this file — never trust client-side checks alone).
   ============================================================ */

(function () {
  "use strict";

  const hasFirebaseSDK = typeof firebase !== "undefined";
  const isPlaceholder = !hasFirebaseSDK || !window.PORTFOLIO_FIREBASE_CONFIG || /PASTE_/.test((window.PORTFOLIO_FIREBASE_CONFIG || {}).apiKey || "");

  if (!hasFirebaseSDK) {
    console.warn("Firebase SDK didn't load (offline, or blocked network) — showing static content only.");
  } else if (isPlaceholder) {
    console.info("Firebase isn't configured yet (firebase-config.js still has placeholder values) — showing static content. See the deployment guide to enable editing.");
  }

  let auth = null, db = null, storage = null;
  if (hasFirebaseSDK && !isPlaceholder) {
    try {
      firebase.initializeApp(window.PORTFOLIO_FIREBASE_CONFIG);
      auth = firebase.auth();
      db = firebase.firestore();
      // Some networks (college/campus wifi, certain ISPs, strict firewalls) silently
      // block Firestore's default streaming connection, which surfaces as a generic
      // "client is offline" error even when you're online. Long-polling is slightly
      // slower but works almost everywhere, so we use it unconditionally.
      try {
        db.settings({ experimentalForceLongPolling: true, merge: true });
      } catch (settingsErr) {
        console.warn("Could not apply Firestore long-polling setting:", settingsErr.message);
      }
      storage = firebase.storage();
    } catch (e) {
      console.warn("Firebase initialization failed:", e.message);
      auth = db = storage = null;
    }
  }

  let isAdmin = false;
  let editMode = false;
  let currentUser = null;

  /* ---------------- seed data (today's real content) ---------------- */
  const SEED = {
    profile: {
      photoURL: null, // null = keep the baked-in hero photo until admin uploads a new one
      resumeURL: null, // null = keep the baked-in resume until admin uploads a new one
      tagline: "I write code that untangles messy, real-world problems — from routing traffic more efficiently to catching plagiarism before it slips through. Currently deepening my grip on algorithms, systems and machine learning.",
      stats: { cgpa: "9.67", leetcode: "100+", codechef: "82", hackathon: "01st" }
    },
    skills: [
      { category: "Languages", subtitle: "Written & comfortable debugging", items: ["Java", "Python", "JavaScript"], order: 1 },
      { category: "CS fundamentals", subtitle: "What most projects are built on", items: ["Data Structures", "Algorithms", "Object-Oriented Programming"], order: 2 },
      { category: "Systems", subtitle: "Comfortable on the command line", items: ["Linux"], order: 3 },
      { category: "Applied areas", subtitle: "Where I'm building depth", items: ["Machine Learning", "Web Development"], order: 4 }
    ],
    certifications: [
      { name: "Machine Learning with Python", issuer: "IBM", group: "Data & machine learning", order: 1 },
      { name: "Data Science Essentials with Python", issuer: "", group: "Data & machine learning", order: 2 },
      { name: "Linux I", issuer: "Cisco Networking Academy", group: "Systems & security", order: 3 },
      { name: "Linux II", issuer: "Cisco Networking Academy", group: "Systems & security", order: 4 },
      { name: "Introduction to Cybersecurity", issuer: "Cisco Networking Academy", group: "Systems & security", order: 5 },
      { name: "Cyber Threat Management", issuer: "Cisco Networking Academy", group: "Systems & security", order: 6 },
      { name: "Network Defense", issuer: "Cisco Networking Academy", group: "Systems & security", order: 7 },
      { name: "Endpoint Security", issuer: "Cisco Networking Academy", group: "Systems & security", order: 8 },
      { name: "HTML Essentials 1", issuer: "Cisco Networking Academy", group: "Web development", order: 9 },
      { name: "CSS Essentials 1", issuer: "Cisco Networking Academy", group: "Web development", order: 10 },
      { name: "JavaScript Essentials 1", issuer: "Cisco Networking Academy", group: "Web development", order: 11 }
    ],
    projects: [
      { title: "Traffic Route Optimisation System", description: "A Python system that analyses traffic conditions and computes the most efficient route between two points, aimed at cutting travel time, fuel use and congestion in urban areas.", tags: "Python, Graph algorithms, Optimisation", repoUrl: "https://github.com/RaghuramReddy205/Traffic-Route-optimisation-system", order: 1 },
      { title: "Plagiarism Detection Engine for Academic Submissions", description: "A tool built to compare student submissions and flag similarity at scale, replacing the slow, error-prone process of checking assignments by hand.", tags: "Python, Text similarity, Academic tooling", repoUrl: "https://github.com/RaghuramReddy205/Plagiarism-Detection-Engine-for-Academic-Submissions", order: 2 },
      { title: "College Transport Management System", description: "A management system for coordinating college transport — routes, vehicles and schedules handled in one place instead of scattered spreadsheets.", tags: "Full-stack, Database, Academic project", repoUrl: "https://github.com/RaghuramReddy205/College-Transport-Management-System-", order: 3 },
      { title: "ResiSolve — Apartment Complaint Management System", description: "An online complaint-management system for residential apartments, letting residents log issues and track resolution instead of relying on word of mouth.", tags: "Java, Data Structures, DSA project", repoUrl: "https://github.com/RaghuramReddy205/ResiSolve_dsa", order: 4 },
      { title: "Multithreaded Linux Application Using POSIX Threads and Mutexes", description: "A concurrent systems-programming exercise on Linux, using POSIX threads and mutexes to coordinate shared resources safely across multiple threads.", tags: "C, POSIX threads, Concurrency", repoUrl: "https://github.com/RaghuramReddy205/Multithreaded-Linux-Application-Using-POSIX-Threads-and-Mutexes", order: 5 },
      { title: "OSSP Project", description: "A collaborative operating-systems / software-practice project built with a teammate, applying core OS concepts to a working application.", tags: "Collaborative, Systems", repoUrl: "https://github.com/nikhilkrishna369/OSSP_Project", order: 6 }
    ],
    experience: [],
    achievements: [
      { value: "1st", desc: "Place at the Novus technical hackathon — designed and shipped a working solution under tight deadlines, with strong problem-solving and teamwork under pressure.", order: 1 },
      { value: "100+", desc: "Problems solved on LeetCode, building consistency in data structures and algorithmic thinking.", order: 2 },
      { value: "82", desc: "Problems solved on CodeChef, sharpening competitive programming and problem-solving speed.", order: 3 }
    ]
  };

  /* ---------------- helpers ---------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function setAdminUI() {
    document.body.classList.toggle("edit-mode", editMode);
    $$(".admin-only").forEach((el) => { el.style.display = editMode ? "" : "none"; });
    const fab = $("#mainFab");
    const lockIcon = $(".fab-icon-lock", fab);
    const pencilIcon = $(".fab-icon-pencil", fab);
    const signOutFab = $("#signOutFab");
    if (isAdmin) {
      lockIcon.style.display = "none";
      pencilIcon.style.display = "";
      fab.classList.toggle("editing", editMode);
      fab.title = editMode ? "Turn editing off" : "Turn editing on";
      signOutFab.style.display = "";
    } else {
      lockIcon.style.display = "";
      pencilIcon.style.display = "none";
      fab.classList.remove("editing");
      fab.title = "Sign in to edit";
      signOutFab.style.display = "none";
    }
  }

  function openModal(id) { $("#" + id).classList.add("open"); }
  function closeModal(id) { $("#" + id).classList.remove("open"); }
  $$("[data-close-modal]").forEach((btn) => btn.addEventListener("click", () => closeModal(btn.dataset.closeModal)));

  /* ---------------- auth ---------------- */
  $("#mainFab").addEventListener("click", () => {
    if (!currentUser) { openModal("loginModal"); return; }
    editMode = !editMode;
    setAdminUI();
  });

  $("#signOutFab").addEventListener("click", () => {
    auth.signOut();
  });

  $("#loginSubmitBtn").addEventListener("click", async () => {
    const email = $("#loginEmail").value.trim();
    const pass = $("#loginPassword").value;
    const errEl = $("#loginError");
    errEl.textContent = "";
    try {
      await auth.signInWithEmailAndPassword(email, pass);
      closeModal("loginModal");
      $("#loginEmail").value = "";
      $("#loginPassword").value = "";
    } catch (e) {
      errEl.textContent = e.message || "Could not sign in.";
    }
  });

  if (auth) {
    auth.onAuthStateChanged((user) => {
      currentUser = user;
      isAdmin = !!(user && window.PORTFOLIO_ADMIN_UID && user.uid === window.PORTFOLIO_ADMIN_UID);
      if (!isAdmin) editMode = false;
      setAdminUI();
      if (isAdmin) maybeSeed();
    });
  }

  /* ---------------- one-time seed (only if collections are empty) ---------------- */
  async function maybeSeed() {
    try {
      const checks = [
        { name: "skills", data: SEED.skills },
        { name: "certifications", data: SEED.certifications },
        { name: "projects", data: SEED.projects },
        { name: "achievements", data: SEED.achievements }
      ];
      const batch = db.batch();
      let anyWrites = false;
      for (const c of checks) {
        const snap = await db.collection(c.name).limit(1).get();
        if (snap.empty) {
          c.data.forEach((item) => { batch.set(db.collection(c.name).doc(), item); anyWrites = true; });
        }
      }
      const profileDoc = await db.collection("config").doc("profile").get();
      if (!profileDoc.exists) {
        batch.set(db.collection("config").doc("profile"), { tagline: SEED.profile.tagline, stats: SEED.profile.stats }, { merge: true });
        anyWrites = true;
      }
      if (anyWrites) {
        await batch.commit();
        console.log("Seeded missing content into Firestore.");
      }
    } catch (e) {
      console.warn("Seeding skipped (likely a permissions issue):", e.message);
    }
  }

  /* ---------------- generic entity modal (add/edit) ---------------- */
  function showEntityForm(title, schema, initial, onSave) {
    $("#entityModalTitle").textContent = title;
    const fieldsEl = $("#entityModalFields");
    fieldsEl.innerHTML = "";
    schema.forEach((f) => {
      const wrap = document.createElement("div");
      wrap.className = "modal-field";
      const label = document.createElement("label");
      label.textContent = f.label;
      wrap.appendChild(label);
      const input = f.type === "textarea" ? document.createElement("textarea") : document.createElement("input");
      if (f.type !== "textarea") input.type = "text";
      input.id = "field_" + f.key;
      input.value = initial && initial[f.key] != null ? initial[f.key] : "";
      wrap.appendChild(input);
      fieldsEl.appendChild(wrap);
    });
    $("#entityModalError").textContent = "";
    openModal("entityModal");
    const saveBtn = $("#entitySaveBtn");
    const handler = async () => {
      const values = {};
      schema.forEach((f) => { values[f.key] = $("#field_" + f.key).value.trim(); });
      try {
        saveBtn.disabled = true;
        await onSave(values);
        closeModal("entityModal");
      } catch (e) {
        $("#entityModalError").textContent = e.message || "Could not save.";
      } finally {
        saveBtn.disabled = false;
        saveBtn.removeEventListener("click", handler);
      }
    };
    saveBtn.addEventListener("click", handler);
  }

  function confirmDelete(msg) { return window.confirm(msg || "Delete this item?"); }

  /* ---------------- SKILLS ---------------- */
  function renderSkills(docs) {
    const root = $("#skillsRows");
    root.innerHTML = "";
    docs.sort((a, b) => (a.data.order || 0) - (b.data.order || 0)).forEach(({ id, data }) => {
      const row = document.createElement("div");
      row.className = "skill-row";
      row.innerHTML = `
        <div class="cat">${esc(data.category)}${data.subtitle ? `<span>${esc(data.subtitle)}</span>` : ""}</div>
        <div class="chips">${(data.items || []).map((i) => `<span>${esc(i)}</span>`).join("")}</div>
        <div class="entity-toolbar">
          <button data-act="edit" title="Edit">&#9998;</button>
          <button data-act="del" title="Delete">&times;</button>
        </div>`;
      row.querySelector('[data-act="edit"]').addEventListener("click", () => editSkill(id, data));
      row.querySelector('[data-act="del"]').addEventListener("click", async () => {
        if (confirmDelete("Delete this skill category?")) await db.collection("skills").doc(id).delete();
      });
      root.appendChild(row);
    });
  }

  function editSkill(id, data) {
    showEntityForm(id ? "Edit skill category" : "Add skill category", [
      { key: "category", label: "Category (e.g. Languages)" },
      { key: "subtitle", label: "Subtitle (optional)" },
      { key: "items", label: "Skills, comma separated" }
    ], data ? { category: data.category, subtitle: data.subtitle || "", items: (data.items || []).join(", ") } : null,
      async (values) => {
        const payload = {
          category: values.category,
          subtitle: values.subtitle,
          items: values.items.split(",").map((s) => s.trim()).filter(Boolean),
          order: (data && data.order) || Date.now()
        };
        if (id) await db.collection("skills").doc(id).update(payload);
        else await db.collection("skills").add(payload);
      });
  }
  $("#addSkillBtn").addEventListener("click", () => editSkill(null, null));

  /* ---------------- CERTIFICATIONS ---------------- */
  function renderCertifications(docs) {
    const root = $("#certContainer");
    root.innerHTML = "";
    const groups = {};
    docs.forEach((d) => {
      const g = d.data.group || "Other";
      groups[g] = groups[g] || [];
      groups[g].push(d);
    });
    Object.keys(groups).forEach((groupName) => {
      const groupEl = document.createElement("div");
      groupEl.className = "cert-group";
      groupEl.innerHTML = `<div class="cert-group-label mono">${esc(groupName)}</div>`;
      groups[groupName]
        .sort((a, b) => (a.data.order || 0) - (b.data.order || 0))
        .forEach(({ id, data }) => {
          const item = document.createElement("div");
          item.className = "cert-item";
          item.innerHTML = `
            <span class="cert-name">${esc(data.name)}</span>
            ${data.issuer ? `<span class="cert-issuer mono">${esc(data.issuer)}</span>` : ""}
            <div class="entity-toolbar">
              <button data-act="edit" title="Edit">&#9998;</button>
              <button data-act="del" title="Delete">&times;</button>
            </div>`;
          item.querySelector('[data-act="edit"]').addEventListener("click", () => editCertification(id, data));
          item.querySelector('[data-act="del"]').addEventListener("click", async () => {
            if (confirmDelete("Delete this certification?")) await db.collection("certifications").doc(id).delete();
          });
          groupEl.appendChild(item);
        });
      root.appendChild(groupEl);
    });
  }

  function editCertification(id, data) {
    showEntityForm(id ? "Edit certification" : "Add certification", [
      { key: "name", label: "Certification name" },
      { key: "issuer", label: "Issuer (optional)" },
      { key: "group", label: "Group (e.g. Data & machine learning)" }
    ], data, async (values) => {
      const payload = { name: values.name, issuer: values.issuer, group: values.group || "Other", order: (data && data.order) || Date.now() };
      if (id) await db.collection("certifications").doc(id).update(payload);
      else await db.collection("certifications").add(payload);
    });
  }
  $("#addCertBtn").addEventListener("click", () => editCertification(null, null));

  /* ---------------- PROJECTS ---------------- */
  function renderProjects(docs) {
    const root = $("#projectsList");
    root.innerHTML = "";
    docs.sort((a, b) => (a.data.order || 0) - (b.data.order || 0)).forEach(({ id, data }, idx) => {
      const num = String(idx + 1).padStart(2, "0");
      const tags = (data.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
      const el = document.createElement("div");
      el.className = "project";
      el.innerHTML = `
        <div class="pnum mono">${num}</div>
        <div>
          <h3>${esc(data.title)}</h3>
          <p>${esc(data.description)}</p>
          <div class="tags">${tags.map((t) => `<span>${esc(t)}</span>`).join("")}</div>
        </div>
        ${data.repoUrl ? `<a class="plink" href="${esc(data.repoUrl)}" target="_blank" rel="noopener">View repo <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17 17 7M7 7h10v10"/></svg></a>` : "<span></span>"}
        <div class="entity-toolbar">
          <button data-act="edit" title="Edit">&#9998;</button>
          <button data-act="del" title="Delete">&times;</button>
        </div>`;
      el.querySelector('[data-act="edit"]').addEventListener("click", () => editProject(id, data));
      el.querySelector('[data-act="del"]').addEventListener("click", async () => {
        if (confirmDelete("Delete this project?")) await db.collection("projects").doc(id).delete();
      });
      root.appendChild(el);
    });
  }

  function editProject(id, data) {
    showEntityForm(id ? "Edit project" : "Add project", [
      { key: "title", label: "Project title" },
      { key: "description", label: "Description", type: "textarea" },
      { key: "tags", label: "Tags, comma separated" },
      { key: "repoUrl", label: "GitHub URL" }
    ], data, async (values) => {
      const payload = { ...values, order: (data && data.order) || Date.now() };
      if (id) await db.collection("projects").doc(id).update(payload);
      else await db.collection("projects").add(payload);
    });
  }
  $("#addProjectBtn").addEventListener("click", () => editProject(null, null));

  /* ---------------- EXPERIENCE ---------------- */
  function renderExperience(docs) {
    const root = $("#experienceList");
    const section = $("#experience");
    const dot = $("#dotExperience");
    root.innerHTML = "";
    const hasEntries = docs.length > 0;
    section.style.display = (hasEntries || editMode) ? "" : "none";
    if (dot) dot.style.display = hasEntries ? "" : "none";

    docs.sort((a, b) => (a.data.order || 0) - (b.data.order || 0)).forEach(({ id, data }) => {
      const item = document.createElement("div");
      item.className = "tl-item" + (data.current ? " current" : "");
      item.innerHTML = `
        <div class="tl-head"><h3>${esc(data.role)}${data.company ? " · " + esc(data.company) : ""}</h3><span class="tl-when mono">${esc(data.duration || "")}</span></div>
        <div class="tl-sub">${esc(data.description || "")}</div>
        <div class="entity-toolbar">
          <button data-act="edit" title="Edit">&#9998;</button>
          <button data-act="del" title="Delete">&times;</button>
        </div>`;
      item.querySelector('[data-act="edit"]').addEventListener("click", () => editExperience(id, data));
      item.querySelector('[data-act="del"]').addEventListener("click", async () => {
        if (confirmDelete("Delete this role?")) await db.collection("experience").doc(id).delete();
      });
      root.appendChild(item);
    });

    if (!hasEntries && editMode) {
      const hint = document.createElement("p");
      hint.className = "lede";
      hint.style.marginTop = "0";
      hint.textContent = "No roles yet — only you can see this section until you add one.";
      root.appendChild(hint);
    }
  }

  function editExperience(id, data) {
    showEntityForm(id ? "Edit role" : "Add role", [
      { key: "role", label: "Role / title" },
      { key: "company", label: "Company / organisation" },
      { key: "duration", label: "Duration (e.g. Jun 2026 — Present)" },
      { key: "description", label: "Description", type: "textarea" }
    ], data, async (values) => {
      const payload = { ...values, current: /present/i.test(values.duration || ""), order: (data && data.order) || Date.now() };
      if (id) await db.collection("experience").doc(id).update(payload);
      else await db.collection("experience").add(payload);
    });
  }
  $("#addExperienceBtn").addEventListener("click", () => editExperience(null, null));

  /* ---------------- ACHIEVEMENTS ---------------- */
  function renderAchievements(docs) {
    const root = $("#achievementsGrid");
    root.innerHTML = "";
    docs.sort((a, b) => (a.data.order || 0) - (b.data.order || 0)).forEach(({ id, data }) => {
      const cell = document.createElement("div");
      cell.className = "ach-cell";
      cell.innerHTML = `
        <div class="big mono">${esc(data.value)}</div>
        <div class="desc">${esc(data.desc)}</div>
        <div class="entity-toolbar">
          <button data-act="edit" title="Edit">&#9998;</button>
          <button data-act="del" title="Delete">&times;</button>
        </div>`;
      cell.querySelector('[data-act="edit"]').addEventListener("click", () => editAchievement(id, data));
      cell.querySelector('[data-act="del"]').addEventListener("click", async () => {
        if (confirmDelete("Delete this achievement?")) await db.collection("achievements").doc(id).delete();
      });
      root.appendChild(cell);
    });
  }

  function editAchievement(id, data) {
    showEntityForm(id ? "Edit achievement" : "Add achievement", [
      { key: "value", label: "Big number / label (e.g. 1st, 100+)" },
      { key: "desc", label: "Description", type: "textarea" }
    ], data, async (values) => {
      const payload = { ...values, order: (data && data.order) || Date.now() };
      if (id) await db.collection("achievements").doc(id).update(payload);
      else await db.collection("achievements").add(payload);
    });
  }
  $("#addAchievementBtn").addEventListener("click", () => editAchievement(null, null));

  /* ---------------- HERO INTRO + STATS ---------------- */
  $("#editHeroBtn").addEventListener("click", () => {
    showEntityForm("Edit intro", [
      { key: "tagline", label: "Intro text below your name (leave blank to remove it)", type: "textarea" }
    ], { tagline: $("#heroTagline").textContent }, async (values) => {
      await db.collection("config").doc("profile").set({ tagline: values.tagline }, { merge: true });
    });
  });

  $("#editStatsBtn").addEventListener("click", () => {
    showEntityForm("Edit stats & CGPA", [
      { key: "cgpa", label: "CGPA (shown everywhere, e.g. 9.67)" },
      { key: "leetcode", label: "LeetCode stat (e.g. 100+)" },
      { key: "codechef", label: "CodeChef stat (e.g. 82)" },
      { key: "hackathon", label: "Hackathon stat (e.g. 01st)" }
    ], {
      cgpa: $("#statCgpa").textContent,
      leetcode: $("#statLeetcode").textContent,
      codechef: $("#statCodechef").textContent,
      hackathon: $("#statHackathon").textContent
    }, async (values) => {
      await db.collection("config").doc("profile").set({ stats: values }, { merge: true });
    });
  });

  /* ---------------- PROFILE (photo + resume + tagline + stats) ---------------- */
  function renderProfile(data) {
    if (data.photoURL) $("#heroPhoto").src = data.photoURL;
    if (data.resumeURL) {
      $("#resumeDownloadBtn").href = data.resumeURL;
      $("#resumeOpenBtn").href = data.resumeURL;
      $("#resumeDownloadBtn").removeAttribute("download"); // remote URL, browser will still offer save
    }
    if (typeof data.tagline === "string") {
      $("#heroTagline").textContent = data.tagline;
      $("#heroTagline").style.display = data.tagline.trim() ? "" : "none";
    }
    if (data.stats) {
      const s = data.stats;
      if (s.cgpa) {
        $("#statCgpa").textContent = s.cgpa;
        $("#heroCgpaVal").textContent = s.cgpa;
        $("#aboutCgpa").textContent = s.cgpa + " / 10";
        $("#eduCgpaScore").textContent = "CGPA " + s.cgpa + " / 10";
        $("#resumeCgpaVal").textContent = s.cgpa + " / 10";
      }
      if (s.leetcode) $("#statLeetcode").textContent = s.leetcode;
      if (s.codechef) $("#statCodechef").textContent = s.codechef;
      if (s.hackathon) $("#statHackathon").textContent = s.hackathon;
    }
  }

  async function uploadFile(file, path) {
    const ref = storage.ref().child(path);
    await ref.put(file);
    return ref.getDownloadURL();
  }

  $("#photoEditBtn").addEventListener("click", () => $("#photoFileInput").click());
  $("#photoFileInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const url = await uploadFile(file, "uploads/photo-" + Date.now() + "-" + file.name);
      await db.collection("config").doc("profile").set({ photoURL: url }, { merge: true });
    } catch (err) {
      alert("Could not upload photo: " + err.message);
    }
  });

  $("#replaceResumeBtn").addEventListener("click", () => $("#resumeFileInput").click());
  $("#resumeFileInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const url = await uploadFile(file, "uploads/resume-" + Date.now() + "-" + file.name);
      await db.collection("config").doc("profile").set({ resumeURL: url }, { merge: true });
    } catch (err) {
      alert("Could not upload résumé: " + err.message);
    }
  });

  /* ---------------- live listeners (or static fallback) ---------------- */
  function collDocs(snapshot) { return snapshot.docs.map((d) => ({ id: d.id, data: d.data() })); }

  if (!db) {
    const withIds = (arr) => arr.map((data, i) => ({ id: "seed-" + i, data }));
    renderSkills(withIds(SEED.skills));
    renderCertifications(withIds(SEED.certifications));
    renderProjects(withIds(SEED.projects));
    renderExperience(withIds(SEED.experience));
    renderAchievements(withIds(SEED.achievements));
    renderProfile(SEED.profile);
  } else {
    db.collection("skills").onSnapshot((snap) => renderSkills(collDocs(snap)), (e) => console.warn("skills listener:", e.message));
    db.collection("certifications").onSnapshot((snap) => renderCertifications(collDocs(snap)), (e) => console.warn("certifications listener:", e.message));
    db.collection("projects").onSnapshot((snap) => renderProjects(collDocs(snap)), (e) => console.warn("projects listener:", e.message));
    db.collection("experience").onSnapshot((snap) => renderExperience(collDocs(snap)), (e) => console.warn("experience listener:", e.message));
    db.collection("achievements").onSnapshot((snap) => renderAchievements(collDocs(snap)), (e) => console.warn("achievements listener:", e.message));
    db.collection("config").doc("profile").onSnapshot((doc) => { if (doc.exists) renderProfile(doc.data()); }, (e) => console.warn("profile listener:", e.message));
  }

  setAdminUI();
})();
