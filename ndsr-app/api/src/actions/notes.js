import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

const NOTES_PATH = path.join(process.cwd(), 'notes', 'notes.json');

function readNotes() {
    try {
        const data = readFileSync(NOTES_PATH, { encoding: 'utf8' });
        return JSON.parse(data);
    } catch (error) {
        return {};
    }
}

function saveNotes(notes) {
    writeFileSync(NOTES_PATH, JSON.stringify(notes, null, 2), { encoding: 'utf8' });
}

function getDeviceNotes(deviceId) {
    const notes = readNotes();
    return notes[deviceId] || [];
}

function addDeviceNote(deviceId, note) {
    const notes = readNotes();
    if (!notes[deviceId]) notes[deviceId] = [];
    
    const newNote = {
        id: Date.now().toString(),
        text: note.text,
        author: note.author || 'Unknown',
        timestamp: Date.now(),
        editedAt: null
    };
    
    notes[deviceId].push(newNote);
    saveNotes(notes);
    return newNote;
}

function updateDeviceNote(deviceId, noteId, text) {
    const notes = readNotes();
    if (!notes[deviceId]) return null;
    
    const note = notes[deviceId].find(n => n.id === noteId);
    if (!note) return null;
    
    note.text = text;
    note.editedAt = Date.now();
    saveNotes(notes);
    return note;
}

function deleteDeviceNote(deviceId, noteId) {
    const notes = readNotes();
    if (!notes[deviceId]) return false;
    
    const index = notes[deviceId].findIndex(n => n.id === noteId);
    if (index === -1) return false;
    
    notes[deviceId].splice(index, 1);
    saveNotes(notes);
    return true;
}

export { getDeviceNotes, addDeviceNote, updateDeviceNote, deleteDeviceNote };