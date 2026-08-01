package com.cde.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp

class MainActivity : ComponentActivity() {
    private val viewModel: AgentViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colors = darkColors()) {
                MainWorkspace(viewModel)
            }
        }
    }
}

@Composable
fun MainWorkspace(viewModel: AgentViewModel) {
    var prompt by remember { mutableStateOf("") }
    var apiToken by remember { mutableStateOf("my-api-token") }
    var baseURL by remember { mutableStateOf("https://api.openai.com/v1") }

    Row(modifier = Modifier.fillMaxSize().background(Color(0xFF1E1E1E))) {
        // Left Column: Workspace File Explorer and Settings Panel
        Column(
            modifier = Modifier
                .width(280.dp)
                .fillMaxHeight()
                .background(Color(0xFF252526))
                .padding(16.dp)
        ) {
            Text("File Explorer", style = MaterialTheme.typography.h6, color = Color.White)
            Spacer(modifier = Modifier.height(10.dp))
            LazyColumn(modifier = Modifier.weight(1f)) {
                items(viewModel.filesList) { file ->
                    Text(file, color = Color(0xFF61DAFB), modifier = Modifier.padding(vertical = 4.dp))
                }
            }
            Divider(color = Color.Gray, thickness = 1.dp)
            Spacer(modifier = Modifier.height(10.dp))
            Text("AI Settings", style = MaterialTheme.typography.subtitle1, color = Color.White)
            OutlinedTextField(
                value = baseURL,
                onValueChange = { baseURL = it },
                label = { Text("Base URL") },
                colors = TextFieldDefaults.outlinedTextFieldColors(textColor = Color.White)
            )
            OutlinedTextField(
                value = apiToken,
                onValueChange = { apiToken = it },
                label = { Text("API Token") },
                colors = TextFieldDefaults.outlinedTextFieldColors(textColor = Color.White)
            )
        }

        // Right Column: Editor / Prompt input and Interactive Terminal PTY Console Output
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxHeight()
                .padding(16.dp)
        ) {
            // Prompt input section
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                OutlinedTextField(
                    value = prompt,
                    onValueChange = { prompt = it },
                    modifier = Modifier.weight(1f),
                    label = { Text("Enter Agent task...") },
                    colors = TextFieldDefaults.outlinedTextFieldColors(textColor = Color.White)
                )
                Spacer(modifier = Modifier.width(10.dp))
                Button(
                    onClick = { viewModel.executeUserPrompt(prompt, apiToken, baseURL) },
                    enabled = !viewModel.isRunning.value,
                    modifier = Modifier.align(Alignment.CenterVertically)
                ) {
                    Text(if (viewModel.isRunning.value) "Running..." else "Execute")
                }
            }

            Spacer(modifier = Modifier.height(20.dp))

            // Interactive Console Terminal Window (replicates xterm.js / Websocket terminal PTY on Android!)
            Text("Interactive PTY Shell Console Output (NDK/JNI bridged)", style = MaterialTheme.typography.subtitle2, color = Color.Gray)
            Spacer(modifier = Modifier.height(5.dp))
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black)
                    .padding(8.dp)
            ) {
                items(viewModel.logs) { logLine ->
                    Text(
                        text = logLine,
                        color = Color.Green,
                        fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.body2
                    )
                }
            }
        }
    }
}
