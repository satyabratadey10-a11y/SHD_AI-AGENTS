package com.cde.app

import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
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

    init {
        // Spawn local native shell on Android using C++ NDK/JNI
        viewModelScope.launch(Dispatchers.IO) {
            val shell = "/system/bin/sh"
            ptyFd = PtyBridge.spawnPty(shell)
            logs.add("Successfully spawned native PTY shell process (FD: $ptyFd)")

            // Background thread reading from the shell stdout/stderr
            while (ptyFd > 0) {
                val output = PtyBridge.readPty(ptyFd)
                if (output != null) {
                    viewModelScope.launch(Dispatchers.Main) {
                        logs.add(output)
                    }
                }
                Thread.sleep(100)
            }
        }

        refreshFiles()
    }

    fun refreshFiles() {
        viewModelScope.launch(Dispatchers.IO) {
            val rootDir = File("/sdcard") // Android native storage path or app private files
            val list = rootDir.listFiles()?.map { it.name } ?: emptyList()
            viewModelScope.launch(Dispatchers.Main) {
                filesList.clear()
                filesList.addAll(list)
            }
        }
    }

    fun executeUserPrompt(prompt: String, apiKey: String, baseURL: String) {
        isRunning.value = true
        viewModelScope.launch(Dispatchers.IO) {
            try {
                var currentPrompt = prompt
                val MAX_ITERATIONS = 5

                for (i in 0 until MAX_ITERATIONS) {
                    viewModelScope.launch(Dispatchers.Main) {
                        logs.add("[Agent Turn ${i + 1}] Processing next actions...")
                    }

                    // 1. Post request to custom API Endpoint URL
                    val rawResponse = callAiModel(currentPrompt, apiKey, baseURL)
                    val json = JSONObject(rawResponse)

                    if (json.has("done") && json.getBoolean("done")) {
                        val msg = json.optString("finalMessage", "Task completed!")
                        viewModelScope.launch(Dispatchers.Main) {
                            logs.add("[Agent Completion] $msg")
                        }
                        break
                    }

                    if (json.has("actions")) {
                        val actions = json.getJSONArray("actions")
                        for (idx in 0 until actions.length()) {
                            val act = actions.getJSONObject(idx)
                            val type = act.optString("type")

                            viewModelScope.launch(Dispatchers.Main) {
                                logs.add("[Executing Action] Type: $type")
                            }

                            if (type == "writeFile") {
                                val path = act.optString("path")
                                val content = act.optString("content")
                                val file = File("/sdcard", path)
                                file.parentFile?.mkdirs()
                                file.writeText(content)
                                viewModelScope.launch(Dispatchers.Main) {
                                    logs.add("Success: Written file at $path")
                                }
                            } else if (type == "runShell") {
                                val cmd = act.optString("command")
                                PtyBridge.writePty(ptyFd, "$cmd\n")
                            }
                        }
                    }
                    Thread.sleep(1000)
                }
            } catch (e: Exception) {
                viewModelScope.launch(Dispatchers.Main) {
                    logs.add("Error during agent execution loop: ${e.message}")
                }
            } finally {
                viewModelScope.launch(Dispatchers.Main) {
                    isRunning.value = false
                    refreshFiles()
                }
            }
        }
    }

    private fun callAiModel(prompt: String, apiKey: String, baseURL: String): String {
        val endpoint = URL("$baseURL/chat/completions")
        val conn = endpoint.openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("Authorization", "Bearer $apiKey")
        conn.doOutput = true

        val requestBody = JSONObject().apply {
            put("model", "gpt-4o")
            put("messages", JSONArray().apply {
                put(JSONObject().apply {
                    put("role", "system")
                    put("content", "You are an autonomous agent. Respond only with JSON containing an 'actions' array.")
                })
                put(JSONObject().apply {
                    put("role", "user")
                    put("content", prompt)
                })
            })
        }

        conn.outputStream.use { os ->
            os.write(requestBody.toString().toByteArray())
        }

        return conn.inputStream.bufferedReader().use { it.readText() }
    }
}
