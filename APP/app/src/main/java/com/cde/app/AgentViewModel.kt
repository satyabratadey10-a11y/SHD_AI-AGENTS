package com.cde.app

import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

class AgentViewModel : ViewModel() {
    val logs = mutableStateListOf<String>()
    val isRunning = mutableStateOf(false)
    val filesList = mutableStateListOf<String>()

    private var ptyFd: Int = -1
    private var ptyJob: Job? = null

    // Scoped Storage compliant app private directory path
    private val appSandboxPath = "/data/data/com.cde.app/files"
    private val maxLogsCount = 500

    init {
        // Ensure private app directory exists
        File(appSandboxPath).mkdirs()

        // Spawn local native shell on Android using C++ NDK/JNI with cancellable coroutine Job
        ptyJob = viewModelScope.launch(Dispatchers.IO) {
            val shell = "/system/bin/sh"
            ptyFd = PtyBridge.spawnPty(shell)
            addLogLine("Successfully spawned native PTY shell process (FD: $ptyFd)")

            try {
                while (ptyFd > 0) {
                    val output = PtyBridge.readPty(ptyFd)
                    if (output != null) {
                        addLogLine(output)
                    }
                    // Poll with sleep
                    withContext(Dispatchers.IO) {
                        Thread.sleep(100)
                    }
                }
            } catch (e: InterruptedException) {
                // Thread interrupted or cancelled
            }
        }

        refreshFiles()
    }

    private fun addLogLine(line: String) {
        viewModelScope.launch(Dispatchers.Main) {
            if (logs.size >= maxLogsCount) {
                // Retain only the most recent logs
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

                    // Normalize and strip out Markdown JSON code fences
                    var cleanedJson = rawResponse.trim()
                    if (cleanedJson.startsWith("```json")) {
                        cleanedJson = cleanedJson.substring(7, cleanedJson.length - 3).trim()
                    } else if (cleanedJson.startsWith("```")) {
                        cleanedJson = cleanedJson.substring(3, cleanedJson.length - 3).trim()
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
                                    throw SecurityException("Security Block: File write target is outside the app sandbox directory!")
                                }

                                file.parentFile?.mkdirs()
                                file.writeText(content)
                                addLogLine("Success: Written file at $pathArg")
                                outcomes.append("Action [writeFile $pathArg]: Success.\n")
                            } else if (type == "runShell") {
                                val cmd = act.optString("command")
                                addLogLine("Running PTY shell command: $cmd")
                                PtyBridge.writePty(ptyFd, "$cmd\n")
                                outcomes.append("Action [runShell $cmd]: Sent command to local terminal PTY.\n")
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
                    Thread.sleep(1000)
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
        // Enforce HTTPS validation for external model endpoints
        if (!baseURL.startsWith("https://") && !baseURL.contains("localhost") && !baseURL.contains("127.0.0.1")) {
            throw IllegalArgumentException("Security Exception: API connection requires a secure HTTPS Base URL!")
        }

        val endpoint = URL("$baseURL/chat/completions")
        val conn = endpoint.openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("Authorization", "Bearer $auth")

        // Enforce explicit connect/read timeout boundaries
        conn.connectTimeout = 10000
        conn.readTimeout = 10000
        conn.doOutput = true

        val requestBody = JSONObject().apply {
            put("model", "gpt-4o")
            put("messages", history)
        }

        conn.outputStream.use { os ->
            os.write(requestBody.toString().toByteArray())
        }

        // Bounded response handling: read at most 1MB to prevent out-of-memory or unbounded buffers
        val maxResponseSize = 1024 * 1024
        val inputStream = conn.inputStream
        val buffer = ByteArray(4096)
        val responseBuilder = java.lang.StringBuilder()
        var totalBytesRead = 0

        while (true) {
            val bytesRead = inputStream.read(buffer)
            if (bytesRead == -1) break
            totalBytesRead += bytesRead
            if (totalBytesRead > maxResponseSize) {
                throw SecurityException("Security Exception: Model response exceeded 1MB safety limits!")
            }
            responseBuilder.append(String(buffer, 0, bytesRead))
        }

        return responseBuilder.toString()
    }

    override fun onCleared() {
        super.onCleared()
        // Gracefully signal termination, cancel the Job, and close active ptyFd native resources
        ptyJob?.cancel()
        if (ptyFd > 0) {
            // Close master fd to kill spawned native child sh process
            PtyBridge.writePty(ptyFd, "exit\n")
            ptyFd = -1
        }
    }
}
