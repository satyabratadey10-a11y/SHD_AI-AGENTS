package com.cde.app

import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets

class AgentViewModel : ViewModel() {
    val logs = mutableStateListOf<String>()
    val isRunning = mutableStateOf(false)
    val filesList = mutableStateListOf<String>()

    // Model configuration
    val selectedModel = mutableStateOf("gpt-4o")

    private var ptyFd: Int = -1
    private var ptyJob: Job? = null

    // Scoped Storage compliant app private directory path
    private val appSandboxPath = "/data/data/com.cde.app/files"
    private val maxLogsCount = 500

    // Shared logs output buffer to capture terminal commands outcome asynchronously
    private val shellOutputBuffer = java.lang.StringBuilder()

    init {
        // Ensure private app directory exists
        File(appSandboxPath).mkdirs()

        // Spawns local native shell on Android using C++ NDK/JNI with cancellable Job task
        ptyJob = viewModelScope.launch(Dispatchers.IO) {
            val shell = "/system/bin/sh"
            ptyFd = PtyBridge.spawnPty(shell)
            addLogLine("Successfully spawned native PTY shell process (FD: $ptyFd)")

            val decoder = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPLACE)
                .onUnmappableCharacter(CodingErrorAction.REPLACE)

            var trailingBytes = byteArrayOf()

            try {
                while (ptyFd > 0) {
                    val rawBytes = PtyBridge.readPty(ptyFd)
                    if (rawBytes != null) {
                        val combinedBytes = trailingBytes + rawBytes
                        val byteBuffer = ByteBuffer.wrap(combinedBytes)
                        val charBuffer = java.nio.CharBuffer.allocate(combinedBytes.size)

                        decoder.decode(byteBuffer, charBuffer, false)
                        charBuffer.flip()
                        val text = charBuffer.toString()

                        addLogLine(text)
                        synchronized(shellOutputBuffer) {
                            shellOutputBuffer.append(text)
                        }

                        // Retain any incomplete trailing multi-byte sequences for next read
                        val remainingSize = byteBuffer.remaining()
                        if (remainingSize > 0) {
                            trailingBytes = ByteArray(remainingSize)
                            byteBuffer.get(trailingBytes)
                        } else {
                            trailingBytes = byteArrayOf()
                        }
                    }
                    delay(100) // Non-blocking delay
                }
            } catch (e: Exception) {
                // Handle cancellation cleanly
            }
        }

        refreshFiles()
    }

    private fun addLogLine(line: String) {
        viewModelScope.launch(Dispatchers.Main) {
            if (logs.size >= maxLogsCount) {
                logs.removeAt(0)
            }
            logs.add(line)
        }
    }

    fun refreshFiles() {
        viewModelScope.launch(Dispatchers.IO) {
            val rootDir = File(appSandboxPath)
            val list = rootDir.listFiles()?.map { it.name } ?: emptyList()
            viewModelScope.launch(Dispatchers.Main) {
                filesList.clear()
                filesList.addAll(list)
            }
        }
    }

    fun executeUserPrompt(prompt: String, auth: String, baseURL: String) {
        isRunning.value = true
        viewModelScope.launch(Dispatchers.IO) {
            try {
                // Maintain accumulated conversational history across turns to prevent looping
                val history = JSONArray()

                // Add initial system and user prompt
                history.put(JSONObject().apply {
                    put("role", "system")
                    put("content", "You are an autonomous agent. Respond only with JSON containing an 'actions' array.")
                })
                history.put(JSONObject().apply {
                    put("role", "user")
                    put("content", prompt)
                })

                val MAX_ITERATIONS = 5
                for (i in 0 until MAX_ITERATIONS) {
                    addLogLine("[Agent Turn ${i + 1}] Processing next actions...")

                    // 1. Post request with full history context
                    val rawResponse = callAiModel(history, auth, baseURL)

                    // Normalize and strip out Markdown JSON code fences safely using Regex
                    var cleanedJson = rawResponse.trim()
                    if (cleanedJson.startsWith("```")) {
                        val regex = Regex("^```(?:json)?\\s*([\\s\\S]*?)(?:```|$)", RegexOption.IGNORE_CASE)
                        val match = regex.find(cleanedJson)
                        if (match != null) {
                            cleanedJson = match.groupValues[1].trim()
                        }
                    }

                    // Append response to history
                    history.put(JSONObject().apply {
                        put("role", "assistant")
                        put("content", cleanedJson)
                    })

                    val json = JSONObject(cleanedJson)

                    if (json.has("done") && json.getBoolean("done")) {
                        val msg = json.optString("finalMessage", "Task completed!")
                        addLogLine("[Agent Completion] $msg")
                        break
                    }

                    if (json.has("actions")) {
                        val actions = json.getJSONArray("actions")
                        val outcomes = StringBuilder()

                        for (idx in 0 until actions.length()) {
                            val act = actions.getJSONObject(idx)
                            val type = act.optString("type")

                            addLogLine("[Executing Action] Type: $type")

                            if (type == "writeFile") {
                                val pathArg = act.optString("path")
                                val content = act.optString("content")

                                // Direct Path Traversal Prevention: canonicalize both targets and check sandbox startsWith containment
                                val file = File(appSandboxPath, pathArg)
                                val canonicalFile = file.canonicalPath
                                val canonicalSandbox = File(appSandboxPath).canonicalPath

                                if (!canonicalFile.startsWith(canonicalSandbox + File.separator)) {
                                    addLogLine("Security Error: Attempted file write target is outside the sandbox!")
                                    outcomes.append("Action [writeFile $pathArg]: Failed (Security block: path is outside app sandbox).\n")
                                } else {
                                    file.parentFile?.mkdirs()
                                    file.writeText(content)
                                    addLogLine("Success: Written file at $pathArg")
                                    outcomes.append("Action [writeFile $pathArg]: Success.\n")
                                }
                            } else if (type == "runShell") {
                                val cmd = act.optString("command")
                                addLogLine("Running PTY shell command: $cmd")

                                if (ptyFd <= 0) {
                                    outcomes.append("Action [runShell $cmd]: Failed (PTY not active).\n")
                                } else {
                                    // Clear current output buffer before command submission
                                    synchronized(shellOutputBuffer) {
                                        shellOutputBuffer.setLength(0)
                                    }
                                    PtyBridge.writePty(ptyFd, "$cmd\n")

                                    // Wait for bounded interval to asynchronously receive outcomes
                                    delay(2000)

                                    val output: String
                                    synchronized(shellOutputBuffer) {
                                        output = shellOutputBuffer.toString()
                                    }
                                    outcomes.append("Action [runShell $cmd]: Execution Output:\n$output\n")
                                }
                            } else {
                                // Action loop fallback for unrecognized types
                                addLogLine("Warning: Unrecognized action type ignored: $type")
                                outcomes.append("Action [$type]: Ignored (unsupported type).\n")
                            }
                        }

                        // Append outcomes to history user context for subsequent turns
                        history.put(JSONObject().apply {
                            put("role", "user")
                            put("content", outcomes.toString())
                        })
                    }
                    delay(1000) // Non-blocking wait
                }
            } catch (e: Exception) {
                addLogLine("Error during agent execution loop: ${e.message}")
            } finally {
                viewModelScope.launch(Dispatchers.Main) {
                    isRunning.value = false
                    refreshFiles()
                }
            }
        }
    }

    private fun callAiModel(history: JSONArray, auth: String, baseURL: String): String {
        // Enforce HTTPS validation before constructing URL, allowing loopbacks only
        val parsedUrl = URL(baseURL)
        val host = parsedUrl.host.lowercase()
        val protocol = parsedUrl.protocol.lowercase()
        if (protocol == "http") {
            if (host != "localhost" && host != "127.0.0.1") {
                throw IllegalArgumentException("Security Exception: API connection requires a secure HTTPS Base URL!")
            }
        } else if (protocol != "https") {
            throw IllegalArgumentException("Security Exception: API connection requires a secure HTTPS Base URL!")
        }

        val endpoint = URL("$baseURL/chat/completions")
        val conn = endpoint.openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Authorization", "Bearer $auth")

            // Enforce explicit connect/read timeout boundaries
            conn.connectTimeout = 10000
            conn.readTimeout = 10000
            conn.doOutput = true

            val requestBody = JSONObject().apply {
                put("model", selectedModel.value)
                put("messages", history)
            }

            conn.outputStream.use { os ->
                os.write(requestBody.toString().toByteArray())
            }

            val status = conn.responseCode
            val isSuccess = status in 200..299
            val rawStream = if (isSuccess) conn.inputStream else (conn.errorStream ?: conn.inputStream)

            // Secure buffered UTF-8 character decoding up to a maximum safety ceiling of 1MB
            val reader = rawStream.bufferedReader(Charsets.UTF_8)
            val responseBuilder = java.lang.StringBuilder()
            val charBuf = CharArray(2048)
            var totalChars = 0

            while (true) {
                val read = reader.read(charBuf)
                if (read == -1) break
                totalChars += read
                if (totalChars > 1024 * 1024) { // 1MB limit
                    throw SecurityException("Response size exceeded 1MB safety limits!")
                }
                responseBuilder.append(charBuf, 0, read)
            }

            // Parse the OpenAI envelope and extract choices[0].message.content
            val responseBody = responseBuilder.toString()
            val envelope = JSONObject(responseBody)
            val choices = envelope.getJSONArray("choices")
            val message = choices.getJSONObject(0).getJSONObject("message")
            return message.getString("content")
        } finally {
            conn.disconnect()
        }
    }

    override fun onCleared() {
        super.onCleared()
        // Gracefully signal termination, cancel the Job, and close active ptyFd native resources
        ptyJob?.cancel()
        if (ptyFd > 0) {
            PtyBridge.closePty(ptyFd) // Close native master descriptor and reap process cleanly
            ptyFd = -1
        }
    }
}
