(function() {
	const scriptTag = document.currentScript || document.querySelector('script[src*="widget.js"]');
	const apiBaseUrl = scriptTag.getAttribute('data-api-url');
	const assistantId = scriptTag.getAttribute('data-assistant-id');

	if (!apiBaseUrl || !assistantId) {
		console.error('API URL or Assistant ID is not provided!');
		return;
	}

	const link = document.createElement('link');
	link.rel = 'stylesheet';
	link.href = `${apiBaseUrl}/css/widget-styles.css`;
	document.head.appendChild(link);

	const rootId = 'my-assistant-widget';
	let widgetRoot = document.getElementById(rootId);
	if (!widgetRoot) {
		widgetRoot = document.createElement('div');
		widgetRoot.id = rootId;
		document.body.appendChild(widgetRoot);
	}

	const closeSvgPath = `${apiBaseUrl}/close.svg`;

	widgetRoot.innerHTML = `
	  <button class="close-chat-icon" id="close-chat-icon">
		<img src="${closeSvgPath}" alt="Close Chat">
	  </button>
	  <div class="chat-box" id="chat-box"></div>
	  <div class="input-box">
		<input type="text" id="user-input" placeholder="Ask a question..." />
		<button id="send-btn">Send</button>
	  </div>
	`;

	const toggleButton = document.createElement('button');
	toggleButton.classList.add('chat-toggle-button');
	const chatSvgPath = `${apiBaseUrl}/chat.svg`;
	toggleButton.innerHTML = `<img src="${chatSvgPath}" alt="Chat Icon">`;
	document.body.appendChild(toggleButton);

	const openChat = () => {
		widgetRoot.style.display = 'flex';
		toggleButton.style.display = 'none';
	};

	const closeChat = () => {
		widgetRoot.style.display = 'none';
		toggleButton.style.display = 'block';
	};

	toggleButton.addEventListener('click', openChat);

	const closeChatIcon = document.getElementById('close-chat-icon');
	closeChatIcon.addEventListener('click', closeChat);

	const chatBox = document.getElementById('chat-box');
	const inputField = document.getElementById('user-input');
	const sendButton = document.getElementById('send-btn');

	let typingIndicator;

	const formatMessage = (message) => {
		message = message.replace(/\\n\\n/g, '</p><p>');
		message = message.replace(/\\n/g, '<br>');
		message = message.replace(/###\s*(.*)/g, '<h3>$1</h3>');
		message = message.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
		message = message.replace(/(\d+)\.\s*(.*?)(?=\n|$)/g, '<li>$1. $2</li>');
		message = message.replace(/<li>/g, '<ul><li>').replace(/<\/li>/g, '</li></ul>');

		return `<p>${message}</p>`;
	};

	const addMessageToChat = (message, isBot = false, messageId = null) => {
		const messageElem = document.createElement('div');
		messageElem.classList.add('message', isBot ? 'bot' : 'user');

		const imgElem = document.createElement('img');
		imgElem.src = isBot ? `${apiBaseUrl}/bot.svg` : `${apiBaseUrl}/user.svg`;

		const messageContent = document.createElement('div');
		messageContent.classList.add('message-content');
		messageContent.innerHTML = formatMessage(message);

		messageElem.appendChild(imgElem);
		messageElem.appendChild(messageContent);

		chatBox.appendChild(messageElem);

		chatBox.scrollTop = chatBox.scrollHeight;

		return messageElem;
	};


	const sendFeedback = async (messageId, rating = null, feedback = null) => {
		if (!messageId) return;

		try {
			const response = await fetch(`${apiBaseUrl}/api/openai/threads/feedback`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ messageId, rating, feedback }),
			});
		} catch (error) {
			console.error('Failed to send feedback:', error);
		}
	};

	const addTypingIndicator = () => {
		if (!typingIndicator) {
			typingIndicator = document.createElement('div');
			typingIndicator.classList.add('typing-indicator', 'message', 'bot');

			const dot1 = document.createElement('div');
			dot1.classList.add('dot');
			const dot2 = document.createElement('div');
			dot2.classList.add('dot');
			const dot3 = document.createElement('div');
			dot3.classList.add('dot');

			typingIndicator.appendChild(dot1);
			typingIndicator.appendChild(dot2);
			typingIndicator.appendChild(dot3);

			chatBox.appendChild(typingIndicator);
			chatBox.scrollTop = chatBox.scrollHeight;
		}
	};

	const removeTypingIndicator = () => {
		if (typingIndicator) {
			typingIndicator.remove();
			typingIndicator = null;
		}
	};

	const getAnswer = async (threadId, runId, userMessageId) => {
		try {
			const response = await fetch(`${apiBaseUrl}/api/openai/runs/${threadId}/${runId}`);
			const result = await response.json();

			if (result.status === 'completed') {
				const messages = await fetch(`${apiBaseUrl}/api/openai/messages/${threadId}`);
				const messageData = await messages.json();

				removeTypingIndicator();

				const botMessageId = messageData.messages[0].id;
				addMessageToChat(messageData.messages[0].content[0].text.value, true, botMessageId);
			} else {
				setTimeout(() => getAnswer(threadId, runId, userMessageId), 200);
			}
		} catch (error) {
			removeTypingIndicator();
			console.error('Error retrieving answer from assistant:', error);
		}
	};

	const sendMessage = async () => {
		const question = inputField.value.trim();
		if (!question) return;

		addMessageToChat(question, false);
		inputField.value = "";
		addTypingIndicator();

		let threadId = localStorage.getItem('threadId');

		try {
			let getThread;
			if (!threadId) {
				const threadResponse = await fetch(`${apiBaseUrl}/api/openai/threads`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ assistantId }),
				});
				getThread = await threadResponse.json();
				threadId = getThread.id;
				localStorage.setItem('threadId', threadId);
			}

			const response = await fetch(`${apiBaseUrl}/api/openai/threads/messages`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ threadId, assistantId, message: question }),
			});

			removeTypingIndicator();

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let partialMessage = '';
			let messageId = null;

			const botMessageElem = addMessageToChat('', true);

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				partialMessage += decoder.decode(value, { stream: true });

				botMessageElem.querySelector('.message-content').innerHTML = formatMessage(partialMessage);
				chatBox.scrollTop = chatBox.scrollHeight;
			}

			messageId = await getLastBotMessageId(threadId);

			if (messageId) {
				addFeedbackSection(botMessageElem, messageId);
			} else {
				console.error('Error: Bot message ID not found.');
			}

		} catch (error) {
			removeTypingIndicator();
			console.error('Error sending message:', error);
		}
	};

	const getLastBotMessageId = async (threadId) => {
		try {
			const response = await fetch(`${apiBaseUrl}/api/openai/threads/messages/${threadId}`);

			const data = await response.json();

			if (data.messageId) {
				return data.messageId;
			} else {
				console.error('No bot message found');
				return null;
			}
		} catch (error) {
			console.error('Error fetching last bot message:', error);
			return null;
		}
	};

	const addFeedbackSection = (messageElem, messageId) => {
		const feedbackDiv = document.createElement('div');
		feedbackDiv.classList.add('feedback-section');

		const ratingDiv = document.createElement('div');
		ratingDiv.classList.add('rating-section');

		const createButton = (icon, feedbackType) => {
			const button = document.createElement('button');
			button.className = 'feedback-button';
			button.innerHTML = icon;
			button.onclick = () => {
				thumbsUpButton.classList.remove('active');
				thumbsDownButton.classList.remove('active');
				const response = feedbackType === 'like' ? sendFeedback(messageId, 'up') : sendFeedback(messageId, 'down');
				if (response) {
					button.classList.add('active');
				}
			};
			return button;
		};

		const thumbsUpButton = createButton('👍', 'like');
		const thumbsDownButton = createButton('👎', 'dislike');

		ratingDiv.appendChild(thumbsUpButton);
		ratingDiv.appendChild(thumbsDownButton);
		feedbackDiv.appendChild(ratingDiv);

		const feedbackInputDiv = document.createElement('div');
		feedbackInputDiv.classList.add('feedback-input-section');
		feedbackInputDiv.innerHTML = `
        <input class="feedback-input" type="text" placeholder="Leave detailed feedback...">
        <button class="feedback-submit" title="Submit feedback">Submit</button>
    `;

		const feedbackInput = feedbackInputDiv.querySelector('.feedback-input');
		const feedbackSubmit = feedbackInputDiv.querySelector('.feedback-submit');

		feedbackSubmit.onclick = () => {
			const feedbackText = feedbackInput.value.trim();
			if (feedbackText) {
				sendFeedback(messageId, null, feedbackText);
				feedbackInput.value = '';
			}
		};

		feedbackDiv.appendChild(feedbackInputDiv);

		messageElem.parentNode.insertBefore(feedbackDiv, messageElem.nextSibling);

		chatBox.scrollTop = chatBox.scrollHeight;
	};


	sendButton.addEventListener('click', sendMessage);
	inputField.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') sendMessage();
	});
})();
