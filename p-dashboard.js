// --- Configuration ---
const SUPABASE_URL = 'https://kynqldakmqdrvtkptgkc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_kV-S7uk5f0px-PrqTkq-VA_vzrAEB60';
const FEATHERLESS_API_KEY = 'rc_5740afef345ddd13cf013741e33ed21ebf106bc3c850d3e32a11dca127b53a0e';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener("DOMContentLoaded", async () => {
    
    // 1. Session Check
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        window.location.href = 'register.html';
        return;
    }
    const user = session.user;
    const username = user.email.split('@')[0];

    // UI Elements
    const projectSelect = document.getElementById('project-select');
    const createProjectBtn = document.getElementById('create-project-btn');
    const editor = document.getElementById('live-editor');
    const chatMessages = document.getElementById('chat-messages');
    const projectTitleEl = document.getElementById('project-title');
    const collaboratorsEl = document.getElementById('collaborators-list');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    
    // Feature Views
    const flashcardView = document.getElementById('flashcard-view');
    const filesView = document.getElementById('files-view');
    const fileListEl = document.getElementById('file-list');
    const flashcardFront = document.getElementById('flashcard-front');
    const flashcardBack = document.getElementById('flashcard-back');

    let activeProjectId = null;
    let projectChannel = null;

    // Logout
    document.getElementById('logout-btn').addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        window.location.href = 'index.html';
    });

    // AI API Helper
    async function callDeepSeekAI(prompt, systemMsg = "You are StudySync AI.") {
        const response = await fetch("https://api.featherless.ai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${FEATHERLESS_API_KEY}`
            },
            body: JSON.stringify({
                model: "deepseek-ai/DeepSeek-V4-Flash",
                messages: [
                    { role: "system", content: systemMsg },
                    { role: "user", content: prompt }
                ],
                temperature: 0.1
            })
        });
        if (!response.ok) throw new Error(`AI HTTP Error: ${response.status}`);
        const data = await response.json();
        return data.choices[0].message.content;
    }
    
    // Bulletproof JSON cleaner for LLM outputs
    function safeJSONParse(rawText) {
            if (!rawText) throw new Error("Empty AI response received.");
        
            let cleanText = rawText.trim();
        
            // 1. Strip Markdown code fences if present
            cleanText = cleanText.replace(/```json/gi, '').replace(/```/gi, '').trim();
        
            // 2. Extract strictly from the first '{' or '[' to the last '}' or ']'
            const startObj = cleanText.indexOf('{');
            const startArr = cleanText.indexOf('[');
            
            let start = -1;
            if (startObj !== -1 && startArr !== -1) {
                start = Math.min(startObj, startArr);
            } else {
                start = startObj !== -1 ? startObj : startArr;
            }
        
            const endObj = cleanText.lastIndexOf('}');
            const endArr = cleanText.lastIndexOf(']');
            const end = Math.max(endObj, endArr);
        
            if (start === -1 || end === -1 || end <= start) {
                throw new Error("No JSON structure found in AI output.");
            }
        
            cleanText = cleanText.substring(start, end + 1);
        
            // 3. Fix common LLM invalid JSON formatting (trailing commas)
            cleanText = cleanText.replace(/,\s*([\}\]])/g, '$1');
        
            return JSON.parse(cleanText);
````}

    // --- 2. Load & Create Projects ---
    const loadUserProjects = async () => {
        const { data: ownedProjects } = await supabaseClient.from('projects').select('id, title').eq('owner_id', user.id);
        const { data: sharedProjects } = await supabaseClient.from('project_members').select('projects(id, title)').eq('user_email', user.email);

        projectSelect.innerHTML = '<option value="" disabled selected>Select a project...</option>';
        let allProjects = ownedProjects || [];
        if (sharedProjects) {
            sharedProjects.forEach(sp => {
                if (sp.projects && !allProjects.some(p => p.id === sp.projects.id)) allProjects.push(sp.projects);
            });
        }

        allProjects.forEach(proj => {
            const opt = document.createElement('option');
            opt.value = proj.id;
            opt.textContent = proj.title;
            projectSelect.appendChild(opt);
        });
    };

    await loadUserProjects();

    createProjectBtn.addEventListener('click', async () => {
        const title = prompt("Enter a name for your new project:");
        if (!title) return;

        const { data: newProj, error } = await supabaseClient.from('projects').insert([{ title, owner_id: user.id }]).select().single();
        if (error) return alert("Error creating project: " + error.message);

        await loadUserProjects();
        projectSelect.value = newProj.id;
        switchProject(newProj.id, title);
    });

    projectSelect.addEventListener('change', (e) => {
        switchProject(e.target.value, projectSelect.options[projectSelect.selectedIndex].text);
    });

    // --- 3. Switch Workspace Project & Realtime Chat Setup ---
    const switchProject = async (id, title) => {
        activeProjectId = id;
        projectTitleEl.textContent = title;
        editor.disabled = false;
        editor.placeholder = "Start typing... Changes sync live.";

        if (projectChannel) supabaseClient.removeChannel(projectChannel);

        // Fetch Files & Collaborators
        loadFiles();
        loadCollaborators();

        // Subscribe to Realtime Channel (Editor + Chat Broadcast)
        projectChannel = supabaseClient.channel(`room:${activeProjectId}`, {
            config: { broadcast: { self: false } }
        });

        projectChannel
            .on('broadcast', { event: 'doc_edit' }, payload => { editor.value = payload.payload.text; })
            .on('broadcast', { event: 'chat_msg' }, payload => { appendMessage(payload.payload.sender, payload.payload.text, 'peer'); })
            .subscribe();
    };

    // Keystroke Sync
    editor.addEventListener('input', (e) => {
        if (!activeProjectId || !projectChannel) return;
        projectChannel.send({ type: 'broadcast', event: 'doc_edit', payload: { text: e.target.value } });
    });

    // --- 4. Chat System ---
    const appendMessage = (sender, text, type = 'self') => {
        const msg = document.createElement('div');
        msg.className = `message ${type}`;
        msg.innerHTML = `<strong>${sender}:</strong> ${text}`;
        chatMessages.appendChild(msg);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    };

    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (!text) return;

        chatInput.value = '';
        appendMessage('You', text, 'self');

        if (text.startsWith('/ai ')) {
            const prompt = text.replace('/ai ', '');
            appendMessage('System', 'DeepSeek AI is thinking...', 'system');
            try {
                const aiReply = await callDeepSeekAI(prompt);
                if (chatMessages.lastChild) chatMessages.lastChild.remove();
                appendMessage('DeepSeek AI', aiReply, 'ai');
            } catch (err) {
                if (chatMessages.lastChild) chatMessages.lastChild.remove();
                appendMessage('System', 'AI Error: ' + err.message, 'system');
            }
        } else if (activeProjectId && projectChannel) {
            // Send Realtime Broadcast to peers
            projectChannel.send({ type: 'broadcast', event: 'chat_msg', payload: { sender: username, text } });
            // Save to DB
            await supabaseClient.from('messages').insert([{ project_id: activeProjectId, user_id: user.id, sender_name: username, content: text }]);
        }
    });

    // --- 5. Files Upload & Download Listing ---
    const uploadBtn = document.getElementById('upload-file-btn');
    const fileInput = document.getElementById('hidden-file-input');

    uploadBtn.addEventListener('click', () => {
        if (!activeProjectId) return alert("Select a project first!");
        fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !activeProjectId) return;

        uploadBtn.textContent = 'Uploading...';
        const { error } = await supabaseClient.storage.from('projects').upload(`${activeProjectId}/${file.name}`, file, { upsert: true });
        
        if (error) alert("Upload error: " + error.message);
        else {
            alert("File uploaded!");
            loadFiles();
        }
        uploadBtn.textContent = 'Upload File';
    });

    async function loadFiles() {
        if (!activeProjectId) return;
        const { data: files } = await supabaseClient.storage.from('projects').list(activeProjectId);
        fileListEl.innerHTML = '';

        if (!files || files.length === 0) {
            fileListEl.innerHTML = '<li class="empty-state">No files uploaded yet.</li>';
            return;
        }

        files.forEach(f => {
            const li = document.createElement('li');
            li.style.cssText = "display: flex; justify-content: space-between; padding: 0.5rem; border: 2px solid #000; margin-bottom: 0.5rem; background: #fff;";
            
            const { data: publicUrlData } = supabaseClient.storage.from('projects').getPublicUrl(`${activeProjectId}/${f.name}`);
            
            li.innerHTML = `
                <span>${f.name}</span>
                <a href="${publicUrlData.publicUrl}" target="_blank" download class="btn-small">Download</a>
            `;
            fileListEl.appendChild(li);
        });
    }

 // --- 6. AI Flashcards & AI Quiz Buttons ---
    document.getElementById('new-flashcards-btn').addEventListener('click', async () => {
        const topic = prompt("Enter a topic or text to generate Flashcards for:");
        if (!topic) return;
    
        alert("AI is generating flashcard...");
    
        try {
            const promptText = `Generate 1 study flashcard for the topic: "${topic}".
    Output ONLY in this exact format:
    FRONT: [Question or term here]
    BACK: [Answer or definition here]
    
    Do not use markdown, backticks, bolding, or JSON. Just the two lines starting with FRONT: and BACK:.`;
    
            const rawResponse = await callDeepSeekAI(promptText);
            console.log("RAW AI TEXT:", rawResponse); // final line of code (yay!)
    
            // Extract using regular expressions (Works every single time!)
            const frontMatch = rawResponse.match(/FRONT:\s*(.*)/i);
            const backMatch = rawResponse.match(/BACK:\s*(.*)/i);
    
            if (!frontMatch || !backMatch) {
                throw new Error("AI output was missing FRONT: or BACK: labels.");
            }
    
            const frontText = frontMatch[1].trim();
            const backText = backMatch[1].trim();
    
            // Render to UI
            flashcardFront.textContent = frontText;
            flashcardBack.textContent = backText;
            flashcardBack.classList.add('hidden');
    
            // Switch to flashcard tab
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab')[1].classList.add('active');
            editor.classList.add('hidden');
            filesView.classList.add('hidden');
            flashcardView.classList.remove('hidden');
    
        } catch (err) {
            console.error("Flashcard Error:", err);
            alert("Failed to generate flashcard. Try again with a simpler prompt.");
        }
    });

    // --- 7. Tab Switching Logic ---
    document.querySelectorAll('.tab').forEach((tab, index) => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            editor.classList.add('hidden');
            flashcardView.classList.add('hidden');
            filesView.classList.add('hidden');

            if (index === 0) editor.classList.remove('hidden');
            if (index === 1) flashcardView.classList.remove('hidden');
            if (index === 2) {
                filesView.classList.remove('hidden');
                loadFiles();
            }
        });
    });

    document.getElementById('flip-btn').addEventListener('click', () => {
        flashcardFront.classList.toggle('hidden');
        flashcardBack.classList.toggle('hidden');
    });

    async function loadCollaborators() {
        const { data: members } = await supabaseClient.from('project_members').select('user_email').eq('project_id', activeProjectId);
        const memberList = members ? members.map(m => m.user_email.split('@')[0]).join(', ') : '';
        collaboratorsEl.innerHTML = `Collaborators: ${memberList || 'You'} <button class="btn-small" id="invite-btn">+ Invite</button>`;
        
        document.getElementById('invite-btn')?.addEventListener('click', async () => {
            const email = prompt("Enter collaborator email:");
            if (email && activeProjectId) {
                await supabaseClient.from('project_members').insert([{ project_id: activeProjectId, user_email: email }]);
                alert(`Added ${email}!`);
                loadCollaborators();
            }
        });
    }
});
