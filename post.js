const fetch = require('node-fetch'); // Install this module
const myHeaders = new fetch.Headers();

myHeaders.append("x-api-key", "d9d4dc9872cf8f135bc485d95a42e6c23807b164a405ad03dcbe7e5c5ad7ae90");
myHeaders.append("Content-Type", "application/json");

const raw = JSON.stringify({
  "userId": "3233134223",
  "fcmtoken": "y7gguyguig",
  "phraseRemember": "rw3r4q23r"
});

const requestOptions = {
  method: "POST",
  headers: myHeaders,
  body: raw,
  redirect: "follow"
};

fetch("https://beep.s.averox.com/api/users", requestOptions)
  .then(response => response.text())
  .then(result => console.log(result))
  .catch(error => console.error('Error:', error));
