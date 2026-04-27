// BIENVENIDO ANIMADO
const text = "Bienvenido";
let i = 0;

function typeEffect(){
  if(i < text.length){
    document.getElementById("welcomeText").innerHTML += text.charAt(i);
    i++;
    setTimeout(typeEffect, 40);
  }
}

typeEffect();
